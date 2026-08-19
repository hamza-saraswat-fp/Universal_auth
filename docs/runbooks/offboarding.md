# Runbook: offboarding a person

Removing someone's access to every internal tool. Three steps, in this order,
all in the Supabase dashboard of `wrxtvqvrpjhkicjdwqoc`.

## The honest model first

Tokens are stateless — that's what lets every app verify them without calling
home. The flip side: **banning stops refresh; it does not reach out and kill a
token they already hold.** With the 1-hour expiry, the worst case after step 1
is one hour of residual access. That trade was made deliberately
([architecture.md](../architecture.md)); if a specific app ever needs instant
cutoff, it opts into checking `session_id` server-side per request.

## Procedure

1. **Ban the user.** Authentication → Users → find them → **⋯ → Ban user**.
   Banned users can't refresh tokens or sign in again. This is the step that
   matters; do it first.
2. **Revoke their sessions.** Same menu → **Sign out user** (invalidates
   refresh tokens server-side). Belt and suspenders with step 1.
3. **Delete their grants** — so a later un-ban (or account re-creation)
   doesn't silently restore access:

```sql
delete from public.app_permissions
 where user_id = (select id from auth.users where email = 'person@fieldpulse.com');
```

Google Workspace offboarding (IT's side) independently stops new Google
sign-ins — but it does **not** stop Supabase token refresh, so never treat
Workspace suspension as the offboarding. Steps 1–3 are.

## Verify

```sql
select u.email, u.banned_until, count(p.id) as remaining_grants
  from auth.users u
  left join public.app_permissions p on p.user_id = u.id
 where u.email = 'person@fieldpulse.com'
 group by u.email, u.banned_until;
```

Expect `banned_until` far in the future and `remaining_grants = 0`. Within an
hour, every app rejects them; immediately, they can't refresh or sign in.

## Un-offboarding (rehire, mistake)

Un-ban in the same menu, then re-grant apps per
[`operations.md`](operations.md). Grants were deleted, not suspended — that's
deliberate, so restored accounts start from zero access.
