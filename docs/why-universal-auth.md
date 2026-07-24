# Universal Auth — what we're building and how it works

**In one line:** a single Supabase project becomes the identity provider for every internal FieldPulse tool, and a shared npm package lets any app verify identity and permissions in about thirty minutes of integration work.

This is the overview. [`architecture.md`](architecture.md) has the full technical plan — schema, SQL, and the corrections we made to the original design.

---

## The problem

Every internal tool handles its own authentication. Most have Google OAuth wired up individually, each with its own OAuth client in Google Cloud. A few sit behind a shared username and password in middleware.

Four concrete consequences:

| Problem | What it costs us |
|---|---|
| Shared passwords can't be revoked per person | The only remediation is rotating for everyone, so in practice it never happens. Every shared credential is a standing offboarding hole. |
| Offboarding is manual and per-app | Removing someone means visiting N apps and remembering all of them. One miss stays open indefinitely. |
| Every project reimplements login | Roughly a day of work per project, done differently each time, with no shared hardening. |
| No authorization source of truth | "Who can access what" has no answer short of auditing several dashboards by hand. |

## What we're building

One Supabase project, `fieldpulse-auth`, that holds **authentication and permissions only** — no application data. It has four moving parts:

**1. Google Workspace SSO through a single OAuth client.** One OAuth client in Google Cloud replaces the per-app clients we have scattered around today. Its consent screen is set to **Internal**, which means Google itself refuses any account outside the FieldPulse Workspace before a request ever reaches us.

**2. An `app_permissions` table** — the authorization source of truth:

```sql
user_id  uuid    → references auth.users
app      text    → 'comp-intel', 'juju-admin', 'email-agent'
role     text    → 'member' | 'admin'
unique (user_id, app)
```

Granting access is one row. Revoking is one delete.

**3. A Custom Access Token Hook.** A Postgres function that runs when Supabase issues a token. It reads that user's rows from `app_permissions` and stamps them into the token itself:

```json
{ "sub": "…", "email": "you@fieldpulse.com",
  "app_metadata": { "apps": { "comp-intel": "admin", "juju-admin": "member" } } }
```

Roles live in `app_metadata`, which only the auth server can write — never `user_metadata`, which is user-editable and would let anyone grant themselves admin.

**4. Asymmetric signing keys and a public JWKS endpoint.** The project signs tokens with a private key and publishes the corresponding public key at:

```
https://<project>.supabase.co/auth/v1/.well-known/jwks.json
```

**This endpoint is what makes the whole design work.** Any service can verify a token's signature against it — no shared secret to distribute, no API key, and no network call to the auth project on every request. That property is why adding an app is cheap, and why the auth project being slow or briefly unreachable doesn't break apps that are already running.

A second hook, **Before User Created**, rejects any non-`@fieldpulse.com` email at the database level. Redundant with the Internal consent screen on purpose — it's the backstop if that Google setting is ever changed.

## How the pieces connect

```
  Google Workspace ──SSO──► fieldpulse-auth (Supabase)
  (@fieldpulse.com)         ├── one Google OAuth client
                            ├── app_permissions table
                            ├── access token hook  → stamps roles into the JWT
                            ├── before-user-created hook → domain enforcement
                            └── JWKS endpoint (public key)
                                        │
                    signed JWT, roles in app_metadata
                                        │
        ┌───────────────┬───────────────┼───────────────┐
        ▼               ▼               ▼               ▼
   Comp Intel      Juju admin      Email agent     future apps
   dashboard         panel          dashboard
        │               │               │               │
   verifies the token against the public JWKS, then queries
   ITS OWN Supabase project with ITS OWN key, scoped by the
   user id and role from the token
```

**Application data does not move.** Each app keeps its own Supabase project and tables. The app's backend verifies the central token, then queries its own database as it always has. The only thing centralized is identity and permissions.

Worth noting why it works this way: Supabase projects can't natively accept another Supabase project's tokens — third-party auth supports Clerk, Firebase, Auth0, Cognito, and WorkOS, and there's no arbitrary-issuer option. Server-side verification is the pattern that's actually available, and it happens to match how our Vercel and Railway apps are already built.

## What integrating an app looks like

A package, `@fieldpulse/auth`, lives in the [Universal_auth](https://github.com/hamza-saraswat-fp/Universal_auth) repo and gets installed straight from git:

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.1.0"
```

Two environment variables — the entire configuration surface:

```bash
NEXT_PUBLIC_FP_AUTH_URL=https://<project>.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...
```

A backend service that only *verifies* tokens needs just the URL, since JWKS is public and verification requires no key at all.

Then three files:

```ts
// app/auth/callback/route.ts — exchanges the OAuth code for a session (PKCE)
export { GET } from "@fieldpulse/auth/next/callback";

// proxy.ts — refreshes the session on each request, verifying the signature
export { fpAuthProxy as proxy } from "@fieldpulse/auth/next";

// anywhere on the server — throws or redirects if not permitted
const role = await requireAppServer("comp-intel", "admin");
```

The package ships four entry points:

| Entry | Purpose | Dependencies |
|---|---|---|
| `@fieldpulse/auth` | `verifyToken`, `requireApp` — runs on Node, Vercel edge, anywhere with Web Crypto | `jose` only |
| `@fieldpulse/auth/next` | session refresh, server-side guards | `@supabase/ssr`, `next` |
| `@fieldpulse/auth/next/callback` | OAuth code exchange | `@supabase/ssr`, `next` |
| `@fieldpulse/auth/react` | provider and hooks, for rendering decisions only | `react` |

Keeping the core at a single dependency is deliberate: it's what lets a bare Node service — precisely the thing replacing a shared-password middleware — verify a token without pulling in a browser auth library or a React runtime.

## Why its own Supabase project

**Blast radius.** Once application data lives beside the identity tables, a routine migration or a misconfigured row-level-security policy on some dashboard's tables can take down authentication for every internal tool simultaneously. An auth project that holds nothing but auth is one where nothing routine ever changes, so nothing routine can break it.

**Ownership.** This is shared infrastructure. Hosting it inside the Comp Intel project would make one team's tool the owner of everyone's login.

**Operational isolation.** Auth has different uptime requirements and a different change cadence than any single dashboard. Separating them means we can be conservative about one without slowing down the other.

One consequence worth stating: the project **must** live in a paid Supabase org. Free-tier projects pause after roughly a week of inactivity and then return HTTP 540 for everything, including the JWKS endpoint. A paused identity provider is a company-wide login outage plus apps unable to validate tokens they already hold.

## Why Supabase rather than Clerk, Auth0, or Keycloak

| Option | Assessment |
|---|---|
| **Supabase** ✅ | Team already fluent; no new vendor; effectively free at our headcount; sits natively alongside the projects our data lives in; asymmetric keys and auth hooks are first-class features built for exactly this |
| Clerk / Auth0 | Per-seat pricing, a new vendor to manage, and capabilities well beyond what internal tooling needs |
| Keycloak | Self-hosting an identity provider is ongoing operational load we don't want to own |
| Cloudflare Access | Requires every app behind one proxy; still useful as a targeted option for a legacy app not worth migrating |

Supabase gives us what a managed IdP would, using a platform we already run, at no marginal cost.

## What this buys us

- **Offboarding becomes one action.** Disable the user once; every app rejects them. No checklist, no per-app hunting.
- **No passwords anywhere.** Every shared credential gets retired and rotated as its app migrates.
- **A real audit trail.** `select * from app_permissions join auth.users using (user_id)` answers who can access what.
- **Role-based access, uniformly.** `member` and `admin` per app, enforced the same way everywhere instead of reinvented per tool.
- **New projects skip auth entirely.** This matters increasingly as more of the team builds their own tools — auth stops being a day of work and a source of inconsistent security decisions.
- **Fewer credentials in circulation.** One OAuth client instead of one per app; per-app OAuth clients get decommissioned as apps migrate.

## Status and plan

**Done:** repo live with the `@fieldpulse/auth` package scaffolded across all four entry points, CI running typecheck/tests/build on every PR, the working agreement documented, and the full architecture written up. The install-from-git path is verified end to end.

**Scoped:** 17 issues across three milestones in Linear, each with acceptance criteria and verification steps.

| Milestone | Contents |
|---|---|
| **Foundation** | Provision the Supabase project; create the Google OAuth client |
| **Core** | Permissions schema and both hooks; package implementation (verification, Next.js helpers, React hooks); ops runbooks |
| **Rollout** | Pilot on Comp Intel Dashboard → replace shared-password middlewares → decommission legacy OAuth clients |

Foundation and Core are roughly a focused day of work. Rollout is incremental and opportunistic — existing apps keep their current auth until someone is already working in them, so nothing is forced.

**Pilot: the Comp Intel Dashboard.** Fully internal, Supabase-backed, small blast radius, and a real audience so problems surface immediately.

One thing worth flagging from the design review: the original plan's SQL for the access token hook would have issued **every token with empty permissions** — silently, with no error. Postgres auth hooks execute as a role that needs explicit grants, and that role doesn't bypass row-level security, so the intended policy matched zero rows. We'd have discovered it when the pilot's users started getting locked out. Caught and corrected before any code was written; the fix is in the schema issue and in `architecture.md`.

## Out of scope

- **Customer-facing products.** Relay and the onboarding app serve customers, not employees. Not touched.
- **Service-to-service auth.** Juju and the email agent authenticate as services, not users, and keep their own credentials. Whether to bring them onto a standard OAuth client-credentials flow is a parked question, not part of this.
- **Non-FieldPulse accounts.** Hard-blocked by design. Contractor access would need an allow-list table swapped into the domain hook, plus a Google-side answer — usually just issuing a Workspace account.

## Known trade-off

Tokens are stateless, which is what allows apps to verify them without calling home. The consequence: banning a user stops them refreshing, but a token they already hold stays cryptographically valid until it expires. With the default one-hour expiry, worst case is one hour between disabling someone and every app rejecting them.

That's the deliberate cost of the property that makes this cheap and fast. It's also a substantial improvement over a shared password that is never rotated at all. If a specific tool ever needs immediate cutoff, it can opt into checking session state per request, trading a round trip for instant revocation.

## Where to follow along

- **Linear:** Internal AI → [Universal Auth](https://linear.app/fieldpulse/project/universal-auth-2ac2b97ce2dd)
- **Code and docs:** [hamza-saraswat-fp/Universal_auth](https://github.com/hamza-saraswat-fp/Universal_auth)
- **Full technical plan:** [`architecture.md`](architecture.md)
