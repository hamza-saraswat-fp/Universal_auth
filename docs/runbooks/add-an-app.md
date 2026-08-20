# Runbook: add auth to an internal app

The walkthrough for wiring a new (or existing) internal Next.js app into
central auth. Budget ~30 minutes. If something here doesn't survive contact
with reality, the runbook is the bug — fix it in the same PR as your app work.

**Scope check first:** internal, employee-facing tools only. Customer-facing
products (Relay, the Onboarding App) never get wired into this. Services and
bots keep their own credentials.

## 0. Pick an app slug

Lowercase, short, hyphenated: `comp-intel`, `juju-admin`, `email-agent`. It
becomes the key in `app_permissions`, the value in every token's claims, and
the string in every `requireApp` call. A check constraint rejects anything
fancier. Slugs ride inside a cookie on every request — keep them short.

## Which path are you on?

- **Next.js app** → follow every step below.
- **Vite / CRA SPA (no server)** → steps 1–2 as written, then skip the three files and two pages: instead call `configureAuth({ url, publishableKey })` with your `VITE_`-prefixed env values at app startup and wrap the app in `<FpAuthProvider><RequireAuth appName="…">`. Built-in sign-in and no-access screens are included; no `/auth/callback` route exists or is needed — the browser exchanges the OAuth code itself. Continue at step 5 (allow-list). **If the app has its own Supabase data client, set `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }` on it** — its defaults will consume the auth callback's `?code=`. Remember: with no server, this gates who loads the app, not the data behind it.

## 1. Install the package

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.3.0"
```

Pin a tag, never `#main`. The `prepare` script builds on install; consumers
receive `dist/` only.

**Local dev** works as-is if you can `git clone` the repo (the install uses
your git credentials).

**Vercel / Railway** need read access to the private repo at build time. The
standard mechanism: create a fine-grained GitHub PAT with read-only Contents
access to `Universal_auth`, put it in the platform env as `GH_PAT`, and
override the install command to rewrite git URLs through it:

```bash
git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "https://github.com/" && npm install
```

> ⚠️ **Not yet proven on a live deploy.** This is the documented-standard
> approach, but per this runbook's own acceptance bar it gets verified during
> the pilot ([IAI-411](https://linear.app/fieldpulse/issue/IAI-411)) — whoever
> does that replaces this admonition with what actually worked.

## 2. Environment variables

```bash
NEXT_PUBLIC_FP_AUTH_URL=https://wrxtvqvrpjhkicjdwqoc.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...   # from the password manager / Settings → API Keys
```

That's the whole configuration surface. A backend service that only verifies
tokens needs just `FP_AUTH_URL` — JWKS is public. Never give an app any
`sb_secret_` key of the auth project; nothing an app does requires one.

## 3. Three files

```ts
// app/auth/callback/route.ts — PKCE code exchange; sign-in silently no-ops without it
export { GET } from "@fieldpulse/auth/next/callback";
```

```ts
// proxy.ts (Next 16) — or middleware.ts (Next 14/15). NEVER both files:
// two interceptors fight over cookies and the behavior is unpredictable.
import { createAuthProxy, authProxyMatcher } from "@fieldpulse/auth/next";

export const proxy = createAuthProxy({ app: "your-app-slug" }); // export as `middleware` on 14/15
export const config = { matcher: authProxyMatcher };
```

```tsx
// app/layout.tsx — only needed if you use the client hooks
import { FpAuthProvider } from "@fieldpulse/auth/react";
// wrap {children} in <FpAuthProvider>
```

## 4. Two small pages

The proxy redirects people to these; the app renders them. Both are public by
default.

- **`/login`** — a sign-in button: `onClick={() => signInWithGoogle()}` from
  `@fieldpulse/auth/react`. After sign-in, people return to the page they
  originally asked for.
- **`/no-access`** — shown to a signed-in FieldPulse person with no grant for
  this app. Say what this tool is and who to ask for access (with a real name
  or Slack channel). This page existing is what makes "not permitted" look
  intentional instead of broken.

## 5. Redirect allow-list

Supabase dashboard → Authentication → URL Configuration → **Redirect URLs**.
Add one entry per surface this app serves from:

| Surface | Entry |
|---|---|
| Production | `https://your-app.fieldpulse.dev/**` |
| Vercel previews | `https://*-<vercel-team-slug>.vercel.app/**` |
| Local dev | `http://localhost:3000/**` |

The glob rules bite: `*` does **not** cross `/` or `.`, `**` does — so
`https://app.fieldpulse.dev/*` will NOT match `/auth/callback?code=…` (query
strings count toward the match) while `.../**` will. When sign-in bounces to
the wrong place or Supabase refuses the redirect, this table is the first
suspect.

## 6. Grant access and smoke-test

Grant yourself the app (see [`operations.md`](operations.md)), then:

- [ ] Cold browser → any protected path → lands on `/login` → Google → back on the path you asked for
- [ ] Hard refresh — still signed in, no signed-out flash
- [ ] A FieldPulse account **without** a grant → `/no-access`, not an error
- [ ] A protected mutation calls `requireAppServer("your-app-slug")` — the UI hiding a button is not enforcement
- [ ] `middleware.ts`/`proxy.ts`: confirm exactly one exists

## 7. Server-side data access (if this app has its own Supabase project)

The pattern: verify the central token, then query your app's own project with
your app's own key, scoping by `claims.sub` / role. The browser never talks to
your data project's API with central credentials, and the central project
never holds app data.

```ts
const claims = await getServerClaims();          // verified, from @fieldpulse/auth/next
const role = requireApp(claims, "your-app-slug");
// ...query your own Supabase project with its own key, filtered by claims.sub
```
