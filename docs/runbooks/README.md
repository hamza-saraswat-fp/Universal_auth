# Runbooks

Operational procedures for `fieldpulse-auth`. Anything configured by clicking through a console gets written down here — see the dashboard-only work rule in [CLAUDE.md](../../CLAUDE.md).

| Runbook | Covers | Lands in |
|---|---|---|
| [`provisioning.md`](provisioning.md) | The auth project: ref, settings chosen and why, how to rebuild it | ✅ [IAI-404](https://linear.app/fieldpulse/issue/IAI-404) |
| [`google-oauth.md`](google-oauth.md) | The OAuth client, why the audience is Internal, rotating the secret | ✅ [IAI-405](https://linear.app/fieldpulse/issue/IAI-405) |
| `add-an-app.md` | Wiring auth into a new internal app, including redirect allow-list globs | [IAI-410](https://linear.app/fieldpulse/issue/IAI-410) |
| `offboarding.md` | Removing someone's access everywhere, and the real revocation window | [IAI-410](https://linear.app/fieldpulse/issue/IAI-410) |
| `operations.md` | Granting access, auditing, key rotation, what to do during an outage | [IAI-410](https://linear.app/fieldpulse/issue/IAI-410) |

Use placeholders for anything sensitive (`<PROJECT_REF>`, `sb_publishable_<REPLACE_ME>`). Real keys live in env stores and the password manager.
