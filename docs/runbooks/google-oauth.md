# Runbook: the Google OAuth client

One OAuth client for every internal tool, replacing the per-app clients scattered
across Google Cloud. Configured 2026-08-19 ([IAI-405](https://linear.app/fieldpulse/issue/IAI-405)).

## Identity

| | |
|---|---|
| **Google Cloud project** | `fieldpulse-internal-auth`, inside the **fieldpulse.com** organization |
| **Console** | [console.cloud.google.com/auth/overview](https://console.cloud.google.com/auth/overview) (with that project selected) |
| **Client type** | Web application |
| **Authorized redirect URI** | `https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/callback` |
| **Authorized JavaScript origins** | none — only needed for Google's JS widgets, which we don't use |
| **Consumed by** | Supabase → Authentication → Providers → Google |

The Client ID is public by design (it appears in the browser URL during every
sign-in). The **Client secret lives in exactly two places**: the password
manager and the Supabase Google provider config. Never in Slack, Linear, git,
or an env file.

## The setting everything rests on

**Audience: Internal** (Google Auth Platform → Audience). Only accounts in the
fieldpulse.com Workspace can complete sign-in — Google refuses everyone else
before a request ever reaches Supabase — and Internal apps skip Google's
verification review entirely.

Two consequences worth remembering:

- This is the **primary** domain gate. The `before_user_created_hook` in the
  database is the backup, for the day someone changes this setting without
  realizing what it holds up.
- Internal is only available because the GCP project sits **inside the
  fieldpulse.com organization**. Moving the project out of the org (or
  recreating it outside) silently breaks this.

**Scopes:** defaults only (`openid`, `email`, `profile`). Nothing was added
under Data Access, deliberately — sensitive scopes are what drag an app into
verification review, and Supabase needs none of them.

## What was clicked (to recreate from scratch)

1. Google Cloud → project picker → organization **fieldpulse.com** → New
   project `fieldpulse-internal-auth` (parent: fieldpulse.com).
2. [console.cloud.google.com/auth/overview](https://console.cloud.google.com/auth/overview)
   → Get started: app name `FieldPulse Internal Tools`, support email set,
   **Audience: Internal**.
3. **Clients** → Create client → Web application → redirect URI as above →
   Create. Client ID + secret copied to the password manager.
4. Supabase dashboard → Authentication → Providers → **Google** → enabled,
   Client ID + secret pasted, saved.

Note: Google renamed "APIs & Services → OAuth consent screen" to **Google Auth
Platform** in 2025. Older docs (and older memories) point at the old name; the
settings are the same, relocated.

## Rotating the client secret

Do this if the secret is ever exposed, or on offboarding anyone who had
password-manager access to it.

1. Google Cloud → Auth Platform → **Clients** → open the client → **Add
   secret**. Both secrets are now valid at once — this is what makes rotation
   zero-downtime.
2. Paste the new secret into Supabase → Providers → Google → Save.
3. Confirm sign-in works (run the verification below, then a real sign-in).
4. Back in Google Cloud, **delete the old secret**. Update the password manager.

Do not delete the old secret before Supabase has the new one saved — that's the
order that locks everyone out.

## Verification

No credentials needed:

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  "https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/authorize?provider=google"
```

Healthy: `302` with a redirect into `accounts.google.com/o/oauth2/v2/auth?...`
whose `redirect_uri` parameter is the Supabase callback. Observed exactly that
on 2026-08-19. A `400` means the provider is disabled or the credentials were
rejected.

The full loop (Google → callback → session with `apps` claims) is exercised by
the pilot app once the schema migrations are applied.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` at sign-in | The URI on the Google client isn't literally `https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/callback` — check for a trailing slash, `http`, or an app URL pasted in by mistake |
| Non-FieldPulse account: "access blocked" from Google | Working as intended — that's the Internal audience |
| Changes seem ignored right after saving | Google propagation lag: a few minutes, occasionally longer. Wait before re-diagnosing |
| "Internal" missing in Audience | Wrong Google account, or the GCP project isn't inside the fieldpulse.com org |

## Related

- Legacy per-app OAuth clients get retired as apps migrate —
  [IAI-413](https://linear.app/fieldpulse/issue/IAI-413) holds the inventory
  and the delete-then-verify procedure.
- Provisioning of the Supabase project itself: [`provisioning.md`](provisioning.md).
