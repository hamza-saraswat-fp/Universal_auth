# Runbook: the central auth Supabase project

What exists, why it's configured the way it is, and how to rebuild it if it were ever lost.

## Identity

| | |
|---|---|
| **Project ref** | `wrxtvqvrpjhkicjdwqoc` |
| **URL** | `https://wrxtvqvrpjhkicjdwqoc.supabase.co` |
| **Display name** | `Universal_Auth` |
| **Organization** | `fp-evan's Org` — **Pro plan** |
| **Region** | `us-east-2` (East US, Ohio) |
| **Provisioned** | 2026-07-24 ([IAI-404](https://linear.app/fieldpulse/issue/IAI-404)) |

The ref is the durable identifier — it appears in the URL every app verifies against and in the Google OAuth redirect URI, and it does not change if the display name is edited. Neither the ref nor the URL is a secret.

This project holds **auth and permissions only**. No application data ever lands here. If app tables ended up beside the identity tables, a routine migration or a broken RLS policy on some dashboard could take out login for every internal tool simultaneously.

## Why the paid org is non-negotiable

Free-tier projects pause after roughly a week of inactivity, and a paused project returns HTTP 540 for **everything** — database, auth, and the JWKS endpoint. For an identity provider that means two failures at once: nobody can log in anywhere, and apps can't verify tokens they already hold.

The project lives in `fp-evan's Org` on the **Pro** plan, so it never pauses. If this project is ever moved, moving it to a free org is a company-wide outage waiting to happen.

## Access

Organization-wide, so this isn't one person's project — shared infrastructure needs more than one person who can unlock it.

| Member | Role |
|---|---|
| hamza.saraswat@fieldpulse.com | Administrator |
| evan.rallis@fieldpulse.com | Owner |
| gabriel.pinchev@fieldpulse.com | Owner |
| jaden@fieldpulse.com | Administrator |

## Configuration

### JWT signing keys — asymmetric

**Verified active: ES256 (EC P-256).** Projects created after October 2025 default to asymmetric keys, so this was a check rather than a migration.

This is the property the whole architecture rests on. The project signs tokens with a private key and publishes the matching public key, so any service can verify a token with no shared secret, no API key, and no call back to this project per request.

```
https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/.well-known/jwks.json
```

If this ever showed a legacy shared secret instead, migrating would have to happen before anything depended on it.

### API keys

New-model keys only: `sb_publishable_…` and `sb_secret_…`. Projects created after November 2025 have no legacy `anon` / `service_role` keys — their absence is expected, not a misconfiguration.

The publishable key is browser-safe by design but still comes from an env store, never git. **No `sb_secret_` key of this project should ever be given to a consuming app** — apps verify tokens against the public JWKS and never need to authenticate to this project at all.

Copy it from **Settings → API Keys** into Vercel/Railway env stores and the password manager.

### Sessions and JWT expiry

Keep the default **1 hour**.

This number is the worst-case offboarding window. Tokens are stateless, so banning a user stops them refreshing but doesn't invalidate a token they already hold — a longer expiry directly weakens the "disable one user, done everywhere" promise. Supabase discourages going below 5 minutes; 15–30 minutes is reasonable if a tighter window is ever wanted.

### Providers

Email/password stays **disabled**. There are no passwords anywhere in this system — that's the point of the project.

Google is enabled separately in [IAI-405](https://linear.app/fieldpulse/issue/IAI-405), using the redirect URI:

```
https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/callback
```

### Redirect allow-list

Starts empty. Each app adds its own entries as it onboards — production, Vercel previews, and localhost. The glob rules are fiddly enough to deserve their own section in `add-an-app.md`.

## Verification

The JWKS endpoint is the one check that matters, and it needs no credentials:

```bash
curl -s https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/.well-known/jwks.json | jq '.keys[0] | {kty, alg, use}'
```

Expected:

```json
{ "kty": "EC", "alg": "ES256", "use": "sig" }
```

A `540` response means the project is paused — which should be impossible on a paid org, and would mean login is down everywhere.

Confirmed on 2026-07-24 that `@fieldpulse/auth` fetches this live key set correctly: a token signed by an untrusted key was rejected as `invalid_token` rather than `unavailable`, which exercises the whole remote-fetch path against the real endpoint.

The Google provider is live as of 2026-08-19 ([IAI-405](https://linear.app/fieldpulse/issue/IAI-405)) — this returns a `302` toward `accounts.google.com`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/authorize?provider=google"
```

Details and rotation procedure: [`google-oauth.md`](google-oauth.md).

## Still to confirm in the dashboard

These are settings this runbook asserts but that were not independently verified from outside — tick them off and this section goes away:

- [ ] **Authentication → Providers:** Email/password is disabled
- [ ] **Authentication → URL Configuration:** Site URL is set
- [ ] **Authentication → Sessions:** JWT expiry is 1 hour
- [ ] **Settings → API Keys:** publishable key copied into the env stores and password manager

## Rebuilding from scratch

If this project were lost, the recovery order matters:

1. Create a new project in the **paid** org. Region `us-east-2` to match.
2. Confirm asymmetric JWT signing keys are active.
3. Disable email/password; set the Site URL.
4. Apply `supabase/migrations` with `npx supabase db push --linked` — the schema and both auth hooks are versioned in this repo, not held in the dashboard.
5. Re-enable both hooks under **Authentication → Hooks**. Migrations create the functions; enabling them is a dashboard action that does not travel with the SQL.
6. Update the Google OAuth client's redirect URI to the new ref.
7. Update `FP_AUTH_URL` in every consuming app, and in `.env.example` here.

Step 7 is the painful one, and it's the reason the custom-domain question ([IAI-416](https://linear.app/fieldpulse/issue/IAI-416)) is worth a deliberate decision rather than drift: with a custom domain, a rebuild wouldn't require touching every app's environment.

Permission rows in `app_permissions` are **not** recoverable from this repo. They're operational data; if this project were lost, access would have to be re-granted from whatever audit trail exists.
