# supabase/

Source of truth for the `fieldpulse-auth` project's schema. The dashboard is not.

Not yet initialized — the project itself doesn't exist. [IAI-404](https://linear.app/fieldpulse/issue/IAI-404) provisions it and runs `npx supabase init` plus `link`; [IAI-406](https://linear.app/fieldpulse/issue/IAI-406) adds the first migrations (`app_permissions` and both auth hooks).

```bash
npx supabase link --project-ref <ref>
npx supabase migration new <name>
npx supabase db push --linked
```

Two rules that matter more here than in a normal project, both explained in [CLAUDE.md](../CLAUDE.md):

- Never edit an applied migration. Write a new one.
- Auth-hook functions always ship with their `grant`/`revoke` block in the same migration. A hook missing grants to `supabase_auth_admin` doesn't error — it just silently issues tokens with no permissions in them.
