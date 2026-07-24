# Universal Auth

One sign-in for every internal FieldPulse tool.

Sign in with your FieldPulse Google account once, and get access to whichever internal apps you're permitted to use. New projects add auth by installing this package and setting two environment variables.

Tracked in Linear: [Universal Auth](https://linear.app/fieldpulse/project/universal-auth-2ac2b97ce2dd) (team `IAI`).

## The problem this solves

Every internal tool currently has its own auth — mostly Google OAuth wired up per app, a few sitting behind a shared username and password in middleware. That means removing someone's access requires touching every app one at a time, shared passwords can't be revoked for one person at all, and there's nowhere to answer "who can access what."

## How it works

A single Supabase project, `fieldpulse-auth`, is the identity provider for everything.

```
                    ┌──────────────────────────────┐
   Google Workspace │  fieldpulse-auth (Supabase)  │
   (@fieldpulse.com)│  - Google OAuth provider     │
        SSO ───────►│  - app_permissions table     │
                    │  - custom access token hook  │
                    │  - JWKS public key endpoint  │
                    └──────────────┬───────────────┘
                                   │  signed JWTs (asymmetric)
          ┌──────────────┬─────────┴──────┬───────────────┐
          ▼              ▼                ▼               ▼
     Comp Intel      Juju admin     Email agent     Future apps
     (verifies JWT)  (verifies JWT) dashboard       (@fieldpulse/auth)
```

Apps never handle credentials. They receive a token, verify its signature against the auth project's public keys, and read the user's identity and per-app roles from the claims. Because verification uses a public key set, it works offline from the auth project and needs no shared secret — and no API key at all.

App data stays where it already lives. Your app's backend verifies the central token, then queries your app's own Supabase project with its own key.

## Scope

**Internal, employee-facing tools only.** Customer-facing products — including Relay and the Onboarding App — are out of scope.

Service-to-service auth is also out of scope. Juju and the email agent authenticate as services, not as people; this system is for humans in browsers.

## Quickstart for a new app

> Not usable yet — the package is scaffolded but unimplemented. Follow [IAI-407](https://linear.app/fieldpulse/issue/IAI-407), [IAI-408](https://linear.app/fieldpulse/issue/IAI-408), and [IAI-409](https://linear.app/fieldpulse/issue/IAI-409). `docs/runbooks/add-an-app.md` becomes the real guide.

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.1.0"
```

```bash
NEXT_PUBLIC_FP_AUTH_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...
```

A backend service that only verifies tokens needs just the URL.

Then three files: a callback route, a proxy (or middleware) for session refresh, and a guard on whatever you're protecting.

```ts
// app/auth/callback/route.ts
export { GET } from "@fieldpulse/auth/next/callback";
```

```ts
// proxy.ts on Next 16, middleware.ts on Next 14/15 — never both
export { fpAuthProxy as proxy } from "@fieldpulse/auth/next";
```

```ts
// in a server component or route handler
const role = await requireAppServer("your-app-slug");
```

Finally, add your app's URLs to the redirect allow-list in the auth project and insert permission rows for whoever should have access.

## Package layout

| Entry point | What it's for | Dependencies |
|---|---|---|
| `@fieldpulse/auth` | Token verification and role guards. Runs anywhere with Web Crypto. | `jose` only |
| `@fieldpulse/auth/next` | Session refresh and server-side guards | `@supabase/ssr`, `next` |
| `@fieldpulse/auth/next/callback` | PKCE code-exchange route | `@supabase/ssr`, `next` |
| `@fieldpulse/auth/react` | Provider and hooks for rendering | `react` |

The core entry point deliberately has one dependency, so a bare Node service can verify a token without pulling in a browser auth library or a React runtime.

## Operating it

| Task | How |
|---|---|
| Give someone access to an app | One row in `app_permissions` |
| Take it away | Delete the row |
| Offboard someone entirely | Ban the user, revoke their sessions — every app rejects them within the token expiry window |
| Audit who has what | `select * from app_permissions join auth.users using (user_id)` |

Full procedures live in `docs/runbooks/`.

## Development

```bash
npm install --ignore-scripts
npm run typecheck
npm test
npm run build
```

Read [CLAUDE.md](CLAUDE.md) before contributing — it covers the branch and PR workflow, the secrets policy, migration conventions, and the code guardrails that keep the core entry point dependency-free.
