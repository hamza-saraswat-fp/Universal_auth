# Universal Auth — architecture and plan of record

**Status:** approved, in build. Linear: [Universal Auth](https://linear.app/fieldpulse/project/universal-auth-2ac2b97ce2dd) (team `IAI`).

**Goal:** one auth system for every internal tool. Sign in with your FieldPulse Google account once, get access to whatever you're permitted to use. New projects get auth by installing a package and setting two environment variables.

This document supersedes the original planning doc. Where the two differ, this one is correct — the differences are listed in [Corrections](#corrections-to-the-original-plan) at the end, along with why.

---

## Why

Today each internal tool has its own auth — mostly Google OAuth wired up per app, a few sitting behind a shared username and password in middleware. The costs are real:

- **Offboarding risk.** Removing someone's access means touching N apps. Shared passwords can't be revoked per person at all, so in practice they never get rotated.
- **Repeated work.** Every new project reimplements login, sessions, and "who is this user."
- **No single source of truth.** Nowhere to answer "who can access what."
- **Handoff friction.** Giving a tool to CS or another engineer means explaining that tool's bespoke auth.

After: Google SSO restricted to `@fieldpulse.com`, no passwords anywhere, one table controlling who gets into which app, and offboarding that means disabling one user in one place.

## Why Supabase

The team already knows it, it adds no vendor, it's effectively free at our headcount, and it sits natively alongside the Supabase projects our app data already lives in. Clerk and Auth0 are per-seat priced and overkill for internal tools; self-hosting Keycloak is an ops burden we don't want.

## Scope

**Internal, employee-facing tools only.** Customer-facing products — including **Relay** and the **Onboarding App** — are explicitly out of scope and will not be wired into this system.

**Humans in browsers only.** Juju and the email agent authenticate as *services*, not users; they keep their own service credentials. Whether that should change is a parked question ([IAI-417](https://linear.app/fieldpulse/issue/IAI-417)).

---

## Architecture

```
                    ┌──────────────────────────────┐
   Google Workspace │  fieldpulse-auth (Supabase)  │
   (@fieldpulse.com)│  - Google OAuth provider     │
        SSO ───────►│  - app_permissions table     │
                    │  - custom access token hook  │
                    │  - before user created hook  │
                    │  - JWKS public key endpoint  │
                    └──────────────┬───────────────┘
                                   │  signed JWTs (asymmetric)
          ┌──────────────┬─────────┴──────┬───────────────┐
          ▼              ▼                ▼               ▼
     Comp Intel      Juju admin     Email agent     Future apps
     (verifies JWT)  (verifies JWT) dashboard       (@fieldpulse/auth)
```

Apps never handle credentials. They receive a token, verify its signature against the auth project's published public keys, and read identity plus per-app roles from the claims.

The JWKS endpoint is what makes this work:

```
https://<PROJECT_REF>.supabase.co/auth/v1/.well-known/jwks.json
```

Any service can verify a token against it with no shared secret and no API key. That single property is why apps can be added in half an hour.

### Where app data lives

Unchanged: in each app's own Supabase project. The browser talks to `fieldpulse-auth` only for login and session refresh. App data goes through the app's own backend, which verifies the central token and then queries its own project with its own key, scoping by the user id and role from the claims.

This is the right default and covers everything we need. Note that browser-to-database RLS against an app's *own* project using a central token is **not possible** — Supabase's third-party auth accepts only Clerk, Firebase, Auth0, Cognito, and WorkOS, and "another Supabase project" isn't an option. If an app genuinely needs it, the options are hosting those tables in the central project or the federation spike in [IAI-417](https://linear.app/fieldpulse/issue/IAI-417).

---

## The pieces

### 1. Google Cloud — one OAuth client

Consent screen **User type: Internal**. Only FieldPulse Workspace accounts can ever sign in; Google refuses everyone else before a request reaches Supabase, and there's no app verification review. This is the primary domain gate.

Redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.

Create the Supabase project **first** so this URI exists.

### 2. The `fieldpulse-auth` Supabase project

Auth and permissions only — no app data, ever.

**Must be in the paid org.** Free-tier projects pause after about a week of inactivity and then return HTTP 540 for everything, including the JWKS endpoint. For an identity provider that means every internal tool loses login simultaneously and apps can't even verify tokens they already hold.

Asymmetric JWT signing keys come as the default for projects created after October 2025 — verify rather than migrate. API keys are the `sb_publishable_…` / `sb_secret_…` pair; projects created after November 2025 have no legacy `anon`/`service_role` keys, which is expected.

Email/password sign-in stays disabled. There are no passwords in this system.

### 3. `app_permissions`

```sql
create table public.app_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null,                    -- 'comp-intel', 'juju-admin', 'email-agent'
  role text not null default 'member',  -- 'member' | 'admin'
  created_at timestamptz not null default now(),
  unique (user_id, app)
);

alter table public.app_permissions enable row level security;

create policy "read own permissions" on public.app_permissions
  for select to authenticated using (auth.uid() = user_id);

-- Required. The access token hook runs as supabase_auth_admin with no JWT
-- context, so auth.uid() is null and the policy above matches nothing.
create policy "auth admin reads all permissions" on public.app_permissions
  as permissive for select to supabase_auth_admin using (true);
```

Granting access is one row insert. Revoking is one row delete.

### 4. Custom access token hook

Stamps each user's app roles into every JWT they're issued.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  perms  jsonb;
begin
  select coalesce(jsonb_object_agg(app, role), '{}'::jsonb)
    into perms
    from public.app_permissions
   where user_id = (event->>'user_id')::uuid;

  claims := event->'claims';

  -- jsonb_set is a silent no-op when the parent path is missing
  if jsonb_typeof(claims->'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  claims := jsonb_set(claims, '{app_metadata,apps}', perms);
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant all on table public.app_permissions to supabase_auth_admin;
revoke all on table public.app_permissions from authenticated, anon, public;
```

Result:

```json
{ "app_metadata": { "apps": { "comp-intel": "admin", "juju-admin": "member" } } }
```

Roles live in `app_metadata`, never `user_metadata` — the latter is user-editable, so using it for authorization would let anyone make themselves an admin.

Hooks get 2 seconds and a 20KB payload. A single indexed lookup is nowhere near either limit, but keep app slugs short: these claims ride in a cookie on every request.

### 5. Before User Created hook — domain enforcement

Belt and suspenders behind the Internal consent screen, in case that setting is ever changed.

```sql
create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
begin
  if split_part(event->'user'->>'email', '@', 2) <> 'fieldpulse.com' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Only fieldpulse.com accounts are allowed.'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$$;

grant execute on function public.before_user_created_hook to supabase_auth_admin;
revoke execute on function public.before_user_created_hook from authenticated, anon, public;
```

A hook rather than a trigger on `auth.users`: the `auth` schema is Supabase-owned with restricted DDL, and a trigger's exception surfaces as an opaque `500 Database error saving new user` where the hook returns a readable 400. The user row doesn't exist in Postgres yet when this runs, so the email is read off the event.

Swapping the hardcoded domain for an allow-list table is how contractor access would work later ([IAI-415](https://linear.app/fieldpulse/issue/IAI-415)).

### 6. The `@fieldpulse/auth` package

| Entry point | Purpose | Dependencies |
|---|---|---|
| `@fieldpulse/auth` | `verifyToken`, `requireApp` — runs anywhere with Web Crypto | `jose` only |
| `@fieldpulse/auth/next` | session refresh proxy, server guards | `@supabase/ssr`, `next` |
| `@fieldpulse/auth/next/callback` | PKCE code-exchange route | `@supabase/ssr`, `next` |
| `@fieldpulse/auth/react` | provider and hooks, for rendering only | `react` |

Core stays single-dependency so a bare Node service — the thing replacing a shared-password middleware — can verify a token without a browser auth library or a React runtime.

```ts
const { payload } = await jwtVerify(token, JWKS, {
  issuer: `${FP_AUTH_URL}/auth/v1`,
  audience: "authenticated",
});
```

**Every app needs a callback route.** Server-side OAuth uses PKCE, so sign-in returns a `?code=` that must be exchanged for a session. The package ships the handler; without it, sign-in silently does nothing.

**Session refresh must use `getClaims()`, not `getSession()`.** Only the former verifies the signature; the latter returns unverified cookie contents. Next.js 16 renamed `middleware.ts` to `proxy.ts`, so the helper is exported to work as either — an app must never define both files.

Env contract, the whole configuration surface:

```
NEXT_PUBLIC_FP_AUTH_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...
```

A verify-only service needs just the URL.

---

## Rollout

1. **Pilot: Comp Intel Dashboard** ([IAI-411](https://linear.app/fieldpulse/issue/IAI-411)) — internal, Supabase-backed, small blast radius, real audience. Grant permissions before cutting over; run both auth paths in parallel for a few days.
2. **Kill the shared passwords** ([IAI-412](https://linear.app/fieldpulse/issue/IAI-412)) — biggest security win, smallest lift. Rotate the old secrets afterward, not just stop using them.
3. **New projects** start on the package from day one.
4. **Existing Google-auth apps** migrate whenever someone is already working in them. Their current auth keeps working in parallel, so there's no forced deadline.
5. **Decommission old OAuth clients** as each app migrates ([IAI-413](https://linear.app/fieldpulse/issue/IAI-413)).

## Operating it

| Task | How |
|---|---|
| Grant access | Insert a row in `app_permissions`; effective on next token refresh |
| Revoke access | Delete the row; effective on next token refresh |
| Offboard someone | Ban the user, revoke sessions, delete their rows |
| Audit access | `select * from app_permissions join auth.users using (user_id)` |
| Add auth to a project | Install the package, set two env vars, add the callback route and a guard |

## Known limits — state these plainly

- **Offboarding is not instant.** Tokens are stateless, so a banned user's already-issued access token stays cryptographically valid until it expires. Banning stops *refresh*; it doesn't reach out and kill live tokens. With the default 1h expiry, worst case is one hour. An app needing instant revocation must check `session_id` against `auth.sessions` per request, at the cost of a round trip.
- **The auth project is a single point of failure for login.** If it's down, existing sessions keep working until expiry and new logins fail. Acceptable for internal tools; monitored via [IAI-418](https://linear.app/fieldpulse/issue/IAI-418).
- **Key rotation propagates slowly.** JWKS responses cache roughly 10 minutes at the edge plus 10 in client libraries. After revoking a key, assume up to ~20 minutes before every app rejects it.
- **Non-FieldPulse accounts are hard-blocked.** By design. See [IAI-415](https://linear.app/fieldpulse/issue/IAI-415).
- **Legacy apps not worth migrating** can go behind Cloudflare Access individually instead.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Identity provider | Supabase | Team fluency, no new vendor, effectively free, native to existing projects |
| Token verification | Asymmetric keys + JWKS | No shared secrets; any service can verify offline |
| Cross-project data access | Server-side verification | The only pattern actually available; also matches how our apps are built |
| Repo layout | Single package at root | npm can't install a workspace sub-package from a git URL, which would force GitHub Packages tokens into every app |
| Custom auth domain | Deferred, see [IAI-416](https://linear.app/fieldpulse/issue/IAI-416) | Baked into every app's env and the OAuth client, so it's cheapest to decide early — and the answer for internal tools is "not needed" |
| Admin UI | Deferred, see [IAI-414](https://linear.app/fieldpulse/issue/IAI-414) | SQL editor is fine until grant volume or a non-technical owner makes it not fine |

---

## Corrections to the original plan

Recorded because each was a real bug or a claim that wouldn't have survived contact with the platform.

1. **The access token hook SQL was broken.** As originally written, every token would have carried empty permissions with no error anywhere. The hook runs as `supabase_auth_admin`, which needed grants it wasn't given, and that role doesn't bypass RLS — with no JWT context during execution, `auth.uid()` is null and the "read own permissions" policy matched zero rows. Fixed with explicit grants, a permissive policy for the hook's role, and a guard before `jsonb_set` on a nested path.
2. **Domain enforcement moved from a trigger on `auth.users` to the Before User Created hook.** The auth schema is service-owned, and a trigger produces an opaque 500 instead of a clean 400.
3. **No signing-key migration needed.** Asymmetric keys are the default for new projects; the original "migrate the project" step doesn't apply.
4. **API key naming.** `FP_AUTH_ANON_KEY` became `FP_AUTH_PUBLISHABLE_KEY` — new projects have no legacy anon key.
5. **The PKCE callback route was missing entirely.** Sign-in would have failed on the very first app, which is also where the "~30 minutes per app" estimate would have died.
6. **Next.js 16 renamed `middleware.ts` to `proxy.ts`,** and server code must use `getClaims()` rather than `getSession()`.
7. **Cross-project JWT acceptance isn't possible.** The original doc offered "configure that project to accept the central JWTs" as a per-app option; Supabase's third-party auth supports five named providers and no arbitrary issuer.
8. **The paid-org requirement was implicit.** Made explicit, because free-tier pausing would take down login for every tool at once.
9. **Offboarding latency was overstated.** "All apps immediately reject their tokens" is true only on refresh; issued tokens verify until expiry.
10. **Sequencing.** Provision Supabase before creating the Google OAuth client, so the redirect URI exists and there's no circling back.
