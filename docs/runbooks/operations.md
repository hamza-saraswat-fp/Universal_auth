# Runbook: day-to-day operations

Granting and revoking access, auditing, seeding, key rotation, and what to do
when the auth project misbehaves. Everything here runs in the **Supabase SQL
editor** of project `wrxtvqvrpjhkicjdwqoc` unless it says otherwise.

The mental model for all of it: `app_permissions` is the source of truth, and
its contents are stamped into each person's token when the token is issued.
**Every change takes effect on that person's next token refresh — up to 1 hour
later.** Nothing here requires a deploy.

## Grant access

```sql
insert into public.app_permissions (user_id, app, role)
select id, 'comp-intel', 'member'
  from auth.users
 where email = 'person@fieldpulse.com'
on conflict (user_id, app) do update set role = excluded.role;
```

Same statement changes a role (it upserts). Roles are exactly `member` or
`admin` — anything else violates a check constraint, on purpose.

**If it inserts zero rows, the person has never signed in** — `auth.users`
rows are created at first sign-in. Two options:

- Have them sign in once (they'll land on `/no-access`), then grant.
- Pre-create them: **Authentication → Users → Invite user** with their
  fieldpulse.com address. When they later sign in with Google, the identity
  links to that row by verified email.

## Revoke access to one app

```sql
delete from public.app_permissions
 where app = 'comp-intel'
   and user_id = (select id from auth.users where email = 'person@fieldpulse.com');
```

They keep their session; the app disappears from their claims on next refresh.
Full offboarding is a different procedure — see [`offboarding.md`](offboarding.md).

## Audit who has what

```sql
select u.email, p.app, p.role, p.created_at
  from public.app_permissions p
  join auth.users u on u.id = p.user_id
 order by u.email, p.app;
```

And the inverse — who has signed in but holds no grants:

```sql
select u.email, u.created_at as first_seen
  from auth.users u
  left join public.app_permissions p on p.user_id = u.id
 where p.id is null;
```

## Seeding a batch (template)

```sql
with grants (email, app, role) as (
  values
    ('hamza.saraswat@fieldpulse.com', 'comp-intel', 'admin'),
    ('person.two@fieldpulse.com',     'comp-intel', 'member')
)
insert into public.app_permissions (user_id, app, role)
select u.id, g.app, g.role
  from grants g
  join auth.users u on u.email = g.email
on conflict (user_id, app) do update set role = excluded.role;
```

The `join` silently skips anyone without a user row — after running, compare
counts against your list and invite whoever's missing.

## Signing-key rotation

Settings → JWT Keys. Supabase handles the mechanics (standby key → rotate →
revoke), but plan around the caches: **JWKS responses are cached roughly 10
minutes at Supabase's edge plus up to 10 in each verifying service** — assume
~20 minutes after revoking a key before every app rejects tokens signed with
it. Rotate → wait for expiry of tokens signed by the old key → revoke. Never
rotate-and-revoke in one sitting during business hours.

## After changing a hook function

Re-check **Authentication → Hooks** — a signature change can silently detach a
hook. A detached access-token hook doesn't error: it issues tokens with empty
permissions, and people start landing on `/no-access`. That symptom = check
here first. Run `supabase/tests/verify_hooks.sql` after any hook change.

## When the auth project is unreachable

What still works: every already-issued token, verified against each app's
cached JWKS — apps stay up for signed-in users until tokens expire (≤1h).
What breaks: new sign-ins and token refreshes.

1. Check [status.supabase.com](https://status.supabase.com).
2. Probe: `curl -s -o /dev/null -w "%{http_code}" https://wrxtvqvrpjhkicjdwqoc.supabase.co/auth/v1/.well-known/jwks.json` — expect `200`. A `540` means the project is paused, which should be impossible on the paid org; restore from the dashboard immediately.
3. Don't rotate keys or change hooks mid-incident.

Monitoring for this is [IAI-418](https://linear.app/fieldpulse/issue/IAI-418).

## Rules that keep this operable

- Schema changes only via migrations in the repo (`npx supabase migration new`),
  never hand-edits in the dashboard. The SQL editor is for *data* (grants), not DDL.
- Run the advisors check before committing a migration.
- Console-only changes get written into a runbook in the same PR.
