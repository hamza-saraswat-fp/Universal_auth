# supabase/

Source of truth for the auth project's schema. The dashboard is not.

Project ref `wrxtvqvrpjhkicjdwqoc` — see [`docs/runbooks/provisioning.md`](../docs/runbooks/provisioning.md).

```bash
npx supabase link --project-ref wrxtvqvrpjhkicjdwqoc
npx supabase db push --linked
npx supabase migration new <name>
```

## What's here

| Migration | What it does |
|---|---|
| `*_app_permissions.sql` | The `app_permissions` table — who may use which app, and as what |
| `*_custom_access_token_hook.sql` | Stamps per-app roles into every access token |
| `*_before_user_created_hook.sql` | Refuses signups outside `fieldpulse.com` |

`tests/verify_hooks.sql` proves the hooks work. Paste it into the SQL editor after applying migrations — it runs in a transaction and rolls back, and raises with a specific reason on failure.

## Two rules that matter more here than usual

**Never edit an applied migration.** Write a new one.

**Auth-hook functions ship with their `grant`/`revoke` block in the same migration.** A hook missing grants to `supabase_auth_admin` doesn't error — it silently issues tokens with no permissions in them, and nobody notices until people start getting locked out. The same goes for the RLS policy letting `supabase_auth_admin` read `app_permissions`: that role does not bypass RLS, and there's no JWT context during hook execution, so `auth.uid()` is null.

## Enabling the hooks is a separate, manual step

Migrations create the functions. Turning them on happens under **Authentication → Hooks** in the dashboard and **does not travel with this repo**. A hook can also silently detach after a function signature change, so re-check it after any change to one.

`config.toml` enables both hooks for local development (`supabase start`) only.
