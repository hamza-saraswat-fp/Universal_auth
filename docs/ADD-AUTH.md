# Add FieldPulse sign-in to your app

Every internal tool gets "Sign in with your FieldPulse Google account" from one
shared system. No passwords, no per-app Google setup, and when someone leaves,
one switch turns them off everywhere. Adding it to an app takes **~10 minutes**
— every step below has been proven on a real production migration (the Juju
dashboard).

## How it works, in 60 seconds

One Supabase project — `fieldpulse-auth` — is the identity provider for all
internal tools. Your app never sees a password. It sends people to Google,
Google confirms they're a FieldPulse employee, and your app receives a signed
token saying who they are (and, if you use roles, what they may do in *your*
app).

```
 Google Workspace ──sign in──►  fieldpulse-auth (central)
 (@fieldpulse.com only)         issues signed tokens
                                       │
              ┌───────────────┬────────┴───────┬──────────────┐
              ▼               ▼                ▼              ▼
        Juju dashboard   Comp Intel        your app      future apps
```

**Your app's data does not move.** Whatever database your app uses stays
yours. The only thing shared is "who is this person" — answered by the
`@fieldpulse/auth` package, which verifies tokens against the central
project's public keys.

Two access modes:

| Mode | Who gets in | Setup |
|---|---|---|
| **Employee (default)** | anyone signed in with `@fieldpulse.com` | none — zero database steps |
| Grant-controlled | only people granted your app in `app_permissions` | one SQL insert per person — see `runbooks/operations.md` |

Use the default unless your app genuinely needs to exclude some employees.

## Path A — Vite / React SPA (no server)

**1. Install** (both — the second is a peer that npm won't add on its own):

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.4.0" @supabase/ssr
```

**2. Wrap your app** (in `src/main.tsx` or wherever the root renders):

```tsx
import { configureAuth, FpAuthProvider, RequireAuth } from '@fieldpulse/auth/react'

configureAuth({
  url: import.meta.env.VITE_FP_AUTH_URL as string | undefined,
  publishableKey: import.meta.env.VITE_FP_AUTH_PUBLISHABLE_KEY as string | undefined,
})

// around your existing app:
<FpAuthProvider>
  <RequireAuth appName="My Tool">
    <App />
  </RequireAuth>
</FpAuthProvider>
```

That's the whole integration. Sign-in screen, Google flow, and "return to the
page you were on" are all built in. Signed-in state survives refreshes; the
OAuth code exchange happens in the browser — no callback route, no server.

**3. If your app already has its own Supabase client for data** — this is the
one landmine — give it these options, or it will try to eat the sign-in
callback:

```ts
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
```

**4. Env vars** (add to `.env.example` too):

```bash
VITE_FP_AUTH_URL=https://wrxtvqvrpjhkicjdwqoc.supabase.co
VITE_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...   # browser-safe by design
```

## Path B — Next.js (App Router)

**1. Install:**

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.4.0" @supabase/ssr @supabase/supabase-js
```

**2. Three files:**

```ts
// app/auth/callback/route.ts
export { GET } from "@fieldpulse/auth/next/callback";
```

```ts
// proxy.ts (Next 16) — or middleware.ts (Next 14/15). Never both files.
import { createAuthProxy, authProxyMatcher } from "@fieldpulse/auth/next";
export const proxy = createAuthProxy({});           // employee mode
export const config = { matcher: authProxyMatcher };
```

```tsx
// app/layout.tsx — wrap {children} if you use the client hooks
import { FpAuthProvider } from "@fieldpulse/auth/react";
```

Plus two small pages the proxy redirects to: `/login` (a button calling
`signInWithGoogle()`) and `/no-access` (only needed in grant mode).

**3. Env vars:** same values, `NEXT_PUBLIC_` prefix:

```bash
NEXT_PUBLIC_FP_AUTH_URL=https://wrxtvqvrpjhkicjdwqoc.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...
```

A backend service that only *verifies* tokens (`verifyToken` from the core
entry) needs just the URL — verification uses public keys, no API key at all.

## The two human steps (the only clicking)

**1. Env vars on the deploy platform.**

- **Vercel:** the values already exist as **team shared variables**
  (`VITE_FP_AUTH_URL`, `VITE_FP_AUTH_PUBLISHABLE_KEY`). Team Settings →
  Environment Variables → open each → link your project. Done. For a Next.js
  app, add project-level `NEXT_PUBLIC_`-prefixed copies of the same two values
  instead.
- **Private install on Vercel: nothing to configure.** Vercel's GitHub
  connection fetches the private package by itself (proven on the Juju
  dashboard — an explicit install override is unnecessary and actually broke
  the build).
- **Railway:** set the same two env vars, plus `GH_PAT` (the read-only token in
  the password manager / Vercel shared env) and a custom install command:
  `git config --global --add url."https://x-access-token:$GH_PAT@github.com/".insteadOf "ssh://git@github.com/" && git config --global --add url."https://x-access-token:$GH_PAT@github.com/".insteadOf "https://github.com/" && npm install`
  > ⚠️ Not yet proven on a live Railway deploy — whoever does the first one
  > updates this line with what actually worked.

**2. One line in the redirect allow-list.**
[Supabase → fieldpulse-auth → Authentication → URL Configuration](https://supabase.com/dashboard/project/wrxtvqvrpjhkicjdwqoc/auth/url-configuration)
→ Add URL:

```
https://<your-app-domain>/**
```

The `/**` matters (`*` alone doesn't cross `/`). This list is why a stolen
sign-in link can't bounce a session to a hostile site — only domains we
operate, added deliberately. Add `http://localhost:5173/**` (or `:3000`) only
if you'll develop sign-in locally.

## Verify (2 minutes)

1. Open your deployed app in a **private window** → sign-in screen, not your app.
2. Sign in with your `@fieldpulse.com` account → you land where you were going.
3. Hard refresh → still signed in.

## Or just let Claude do it

Paste this into Claude Code in your app's repo:

````text
Add FieldPulse central auth to this app using @fieldpulse/auth. Read
https://github.com/hamza-saraswat-fp/Universal_auth — the file docs/ADD-AUTH.md
is the guide; follow the path matching this repo's stack (Vite SPA vs Next.js).

Specifically:
1. Detect the stack. Install "github:hamza-saraswat-fp/Universal_auth#v0.4.0"
   plus @supabase/ssr (and @supabase/supabase-js on Next).
2. Vite SPA: call configureAuth() with import.meta.env.VITE_FP_AUTH_URL /
   VITE_FP_AUTH_PUBLISHABLE_KEY at the app entry, then wrap the root in
   <FpAuthProvider><RequireAuth appName="<this app's name>">.
   Next.js: add the callback route re-export, the proxy file (createAuthProxy
   + authProxyMatcher — middleware.ts on Next 14/15, proxy.ts on 16, never
   both), and a /login page with a signInWithGoogle() button.
3. If this repo has its own Supabase client for data, set
   auth: { persistSession: false, autoRefreshToken: false,
   detectSessionInUrl: false } on it — otherwise it consumes the sign-in
   callback.
4. Add the two env vars to .env.example (VITE_ or NEXT_PUBLIC_ prefix to
   match the stack); put real values in local .env if it exists.
5. Run the build and tests; fix what breaks.
6. Finish by printing exactly two remaining human steps: link the shared env
   vars to this project on Vercel (or set them + GH_PAT install override on
   Railway), and add https://<production-domain>/** to the central redirect
   allow-list at
   https://supabase.com/dashboard/project/wrxtvqvrpjhkicjdwqoc/auth/url-configuration
````

## Going further

- Lock an app down to specific people/roles: `RequireApp` +
  `runbooks/operations.md` (grants are one SQL insert)
- Day-to-day operations, offboarding, key rotation: `runbooks/`
- How the whole system works: `architecture.md`
