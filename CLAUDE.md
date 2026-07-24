# CLAUDE.md

Working agreement for this repo. Read this before making any change.

## What this repo is

`@fieldpulse/auth` — the package every internal FieldPulse tool uses to authenticate people, plus the SQL migrations for the central `fieldpulse-auth` Supabase project and the runbooks for operating it.

It holds exactly three things:

- the package (`src/`)
- migrations for the central auth project (`supabase/`)
- docs and runbooks (`docs/`)

It does **not** hold app data, app-specific code, or anything belonging to a consuming project. If a change only matters to one app, it belongs in that app's repo.

## Scope boundary

This system is for **internal, employee-facing tools only**. Customer-facing products — including Relay and the Onboarding App — are explicitly out of scope and must not be wired into central auth.

Service-to-service auth is also out of scope: Juju and the email agent authenticate as services with their own credentials. This system is for humans in browsers.

## Workflow

Every change starts from a Linear issue in the [Universal Auth](https://linear.app/fieldpulse/project/universal-auth-2ac2b97ce2dd) project (team `IAI`). No exceptions, including for small fixes — if it's worth doing, it's worth a line in Linear.

1. **Branch off `main`**, named `feature/iai-<number>-<slug>`. Linear generates this name on each issue; copy it, or shorten the slug.
2. **One issue, one branch, one PR.** If a branch starts growing a second concern, that concern is a new issue.
3. **PR title:** `[IAI-<number>] <summary>`. **PR body starts with** `Fixes IAI-<number>`.
4. **Attach the PR URL to the Linear issue** and move the issue to **In Review**.
5. **Human review, then merge.** Never merge your own PR unreviewed.
6. **No direct pushes to `main`** — the initial commit was the only one.

### Dashboard-only work

Some work is clicking through the Supabase or Google Cloud console, with no code to write. That still gets a PR: the checklist lives in the Linear issue, and the PR commits the matching runbook in `docs/runbooks/` recording what was configured and why.

Undocumented console state is how a system becomes un-operable by anyone but its author. That is the exact problem this project exists to fix, so it would be a shame to recreate it here.

## Secrets

Never commit a credential. Not in code, not in a test fixture, not in a runbook, not in a Linear issue.

- `sb_secret_…` keys live only in Supabase, Vercel, and Railway env stores.
- The Google OAuth client secret lives only in Google Cloud and the Supabase provider config.
- `sb_publishable_…` keys are browser-safe by design, but still come from env, not from git.
- Runbooks use placeholders (`<PROJECT_REF>`, `sb_publishable_<REPLACE_ME>`).
- `.env*` is gitignored except `.env.example`.

The project URL is not a secret and may appear in docs.

## Migrations

The `supabase/` directory is the source of truth for the central project's schema. The dashboard is not.

- Create migrations with `npx supabase migration new <name>`. Never hand-name a file — the timestamp prefix is what orders them.
- **Never edit a migration that has been applied.** Write a new one.
- Auth-hook functions must always ship with their `grant`/`revoke` block in the same migration. A hook without grants to `supabase_auth_admin` fails silently and produces tokens with empty claims — no error, just missing permissions.
- Tables the hooks read need a policy allowing `supabase_auth_admin` to select. That role does not bypass RLS, and there is no JWT context during hook execution, so `auth.uid()` is null.
- After changing a hook function's signature, re-check that it is still enabled in **Authentication → Hooks**. It can silently detach.
- Run the advisors check before committing.

## Code guardrails

- **The core entry point (`src/index.ts`) imports `jose` and nothing else.** No Supabase SDK, no React, no Next. A backend service must be able to verify a token without pulling in a browser auth library. A stray import here is easy to add and hard to notice.
- **Server code uses `getClaims()`, never `getSession()`.** Only `getClaims()` verifies the JWT signature. `getSession()` returns unverified cookie contents.
- **Cookies use the `@supabase/ssr` `getAll`/`setAll` contract only.** The older `get`/`set`/`remove` API is gone.
- **Set cache headers on any response that touches auth cookies** (`Cache-Control`, `Expires`, `Pragma`), so a session can't be cached by a CDN and served to someone else.
- **Roles come from `app_metadata`, never `user_metadata`.** `user_metadata` is user-editable — trusting it for authorization would let anyone make themselves an admin.
- **Client-side role checks are for rendering only.** Anything that matters is enforced server-side.
- `next` and `react` stay peer dependencies, never bundled.

## Releases

Consuming apps install from git and pin a tag:

```bash
npm i "github:hamza-saraswat-fp/Universal_auth#v0.1.0"
```

Tag `vX.Y.Z` on `main` after merge. The `prepare` script builds on install, and `files: ["dist"]` keeps source out of the tarball. Bump the version in `package.json` in the same PR as the change, so the tag always matches.

## Commands

```bash
npm install --ignore-scripts   # skips the prepare build
npm run typecheck
npm test
npm run build

npx supabase link --project-ref <ref>
npx supabase migration new <name>
npx supabase db push --linked
```

## Env contract for consuming apps

Two variables, and that's the whole configuration surface:

```
NEXT_PUBLIC_FP_AUTH_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_FP_AUTH_PUBLISHABLE_KEY=sb_publishable_...
```

A service that only verifies tokens needs just the URL — JWKS is public, so verification requires no key at all.
