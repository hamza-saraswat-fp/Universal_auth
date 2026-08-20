# Universal Auth

One sign-in for every internal FieldPulse tool.

Sign in with your FieldPulse Google account once, and get access to whichever internal apps you're permitted to use. New projects add auth by installing this package and setting two environment variables.

**Adding auth to your app? Start at [docs/ADD-AUTH.md](docs/ADD-AUTH.md)** — the proven ~10-minute guide, with a paste-into-Claude prompt that does the wiring for you.

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

## Verifying tokens

The core entry point works today. It's all a backend service needs — an API route, a Railway worker, anything replacing a shared-password middleware.

```ts
import { verifyToken, requireApp, AuthError } from "@fieldpulse/auth";

try {
  const claims = await verifyToken(token);
  const role = requireApp(claims, "comp-intel", "member"); // "member" | "admin"
} catch (error) {
  if (error instanceof AuthError) {
    // error.code: "expired" | "invalid_token" | "forbidden" | "unavailable" | "config"
    // error.status: 401 | 403 | 500 | 503
  }
}
```

`verifyToken` checks the signature against the auth project's public keys, plus the issuer, audience, and expiry. It needs **one environment variable** — `FP_AUTH_URL` — and no API key at all, since the key set is public.

Branch on `error.code` rather than the message:

| `code` | `status` | Means |
|---|---|---|
| `expired` | 401 | Signature was good, token is past expiry — refresh rather than sending the user to log in |
| `invalid_token` | 401 | Malformed, tampered with, unknown signing key, or from a different project |
| `forbidden` | 403 | Authenticated, but no grant for this app or the role is too low |
| `unavailable` | 503 | The key set couldn't be fetched. A problem with the auth project, **not** the token — don't sign anyone out over it |
| `config` | 500 | `FP_AUTH_URL` isn't set |

Other exports:

```ts
getApps(claims)                       // { "comp-intel": "admin", … }, or {}
hasApp(claims, "comp-intel", "admin") // boolean; the non-throwing form
createVerifier({ url, jwks, clockTolerance }) // point at another project, or inject keys
```

`admin` satisfies a `member` requirement; the reverse does not. `requireApp` returns the role actually held, so you can branch without a second lookup.

## Quickstart for a new app

> Every entry point is real as of `v0.3.0`. `docs/runbooks/add-an-app.md` becomes the full walkthrough.

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.3.0"
```

```bash
NEXT_PUBLIC_FP_AUTH_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...
```

A backend service that only verifies tokens needs just the URL.

Then three files: a callback route, a proxy (or middleware) for session refresh, and a guard on whatever you're protecting.

```ts
// app/auth/callback/route.ts — the PKCE code exchange; sign-in doesn't work without it
export { GET } from "@fieldpulse/auth/next/callback";
```

```ts
// proxy.ts on Next 16 — or middleware.ts on Next 14/15, never both
import { createAuthProxy, authProxyMatcher } from "@fieldpulse/auth/next";

export const proxy = createAuthProxy({ app: "your-app-slug" }); // name it `middleware` on Next 14/15
export const config = { matcher: authProxyMatcher };
```

```ts
// role-gated surfaces and mutations, in a server component or route handler
import { requireAppServer } from "@fieldpulse/auth/next";

const role = await requireAppServer("your-app-slug", "admin");
```

The proxy refreshes the session on every request and routes people: signed out → `/login`, signed in without a grant for your app → `/no-access`. Your app renders those two pages — a sign-in button on one, a "here's who to ask for access" note on the other (both paths configurable, always public).

Finally, add your app's URLs to the redirect allow-list in the auth project and insert permission rows for whoever should have access.

## No server? SPAs work too

Vite / CRA apps (no Next.js, no server) skip the three files entirely — the whole integration is one config call and one wrapper:

```tsx
// src/main.tsx
import { configureAuth, FpAuthProvider, RequireAuth } from "@fieldpulse/auth/react";

configureAuth({
  url: import.meta.env.VITE_FP_AUTH_URL,
  publishableKey: import.meta.env.VITE_FP_AUTH_PUBLISHABLE_KEY,
});

// ...
<FpAuthProvider>
  <RequireAuth appName="My Tool">
    <App />
  </RequireAuth>
</FpAuthProvider>
```

`RequireAuth` = any signed-in FieldPulse employee — **no database steps at all**. Signed-out visitors get a built-in sign-in screen and return to the page they were on; the OAuth code exchange happens in the browser, no callback route needed. Use `RequireApp app="slug" role="admin"` instead when the app needs per-person grants.

> ⚠️ If the app has its own Supabase data client, give it
> `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }` —
> its defaults will try to consume the auth callback's `?code=` parameter.

One honest limit: an SPA has no server, so this gates **who can load the app**, not the data layer behind it — that's the app's own backend/RLS concern.

## The client side

Wrap the app once, then render from the hooks. **These decide what to show, never what to allow** — client state can be fabricated, so anything that matters is enforced by the proxy and `requireAppServer()`.

```tsx
// app/layout.tsx
import { FpAuthProvider } from "@fieldpulse/auth/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body><FpAuthProvider>{children}</FpAuthProvider></body></html>;
}
```

```tsx
// app/login/page.tsx
"use client";
import { signInWithGoogle } from "@fieldpulse/auth/react";

export default function Login() {
  return <button onClick={() => signInWithGoogle()}>Sign in with Google</button>;
}
```

```tsx
// anywhere client-side
"use client";
import { useAuth, useAppRole, signOut } from "@fieldpulse/auth/react";

export function Header() {
  const { status, user } = useAuth();          // status: "loading" | "signed-in" | "signed-out"
  const role = useAppRole("your-app-slug");    // "member" | "admin" | null — rendering hint only

  if (status === "loading") return <HeaderSkeleton />; // no signed-out flash on hard refresh
  return (
    <header>
      {user?.name} {role === "admin" && <AdminTabLink />}
      <button onClick={() => signOut()}>Sign out</button>
    </header>
  );
}
```

`signInWithGoogle()` returns people to the page they started on (override with `next`), and `signOut()` hard-navigates so the server sees the cleared session immediately.

## Package layout

| Entry point | What it's for | Dependencies | Status |
|---|---|---|---|
| `@fieldpulse/auth` | Token verification and role guards. Runs anywhere with Web Crypto. | `jose` only | ✅ |
| `@fieldpulse/auth/next` | Auth proxy (session refresh + routing), server-side guards | `@supabase/ssr`, `next` | ✅ |
| `@fieldpulse/auth/next/callback` | PKCE code-exchange route | `@supabase/ssr`, `next` | ✅ |
| `@fieldpulse/auth/react` | Provider, hooks, and SPA guards (`RequireAuth`/`RequireApp`) | `react` | ✅ |

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
