-- Proves both auth hooks actually work. Run after applying the migrations and
-- after enabling the hooks under Authentication -> Hooks.
--
--   Supabase dashboard -> SQL Editor -> paste -> Run
--
-- Everything runs inside a transaction that is rolled back, so it changes
-- nothing. Success is silent: if the script completes without raising, the
-- hooks are wired correctly. Any failure raises with a specific reason.
--
-- Why this exists: the failure mode here is silent. A missing grant or a
-- missing RLS policy does not error at token issuance -- it just produces
-- tokens with no permissions in them, and nobody notices until people start
-- getting locked out of apps.
--
-- The critical line is `set local role supabase_auth_admin`. As postgres you
-- bypass RLS, so this check would pass even if the policy were missing. It has
-- to run as the role the auth server actually uses.

begin;

-- ---------------------------------------------------------------------------
-- 1. Domain enforcement. Needs no user; the hook reads the event, not the DB.
-- ---------------------------------------------------------------------------
do $$
declare
  allowed  jsonb;
  refused  jsonb;
begin
  allowed := public.before_user_created_hook(
    jsonb_build_object('user', jsonb_build_object('email', 'Someone@FieldPulse.com'))
  );
  if allowed <> '{}'::jsonb then
    raise exception 'FAILED: a fieldpulse.com address was refused (got %)', allowed::text;
  end if;

  refused := public.before_user_created_hook(
    jsonb_build_object('user', jsonb_build_object('email', 'someone@gmail.com'))
  );
  if refused -> 'error' ->> 'http_code' <> '400' then
    raise exception 'FAILED: a non-fieldpulse address was not refused (got %)', refused::text;
  end if;

  raise notice 'OK: domain hook allows fieldpulse.com (any casing) and refuses everything else';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Per-app roles in the token. Needs one real user to hang a grant off.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from auth.users) then
    raise exception 'No users yet -- complete one Google sign-in, then re-run this script.';
  end if;
end $$;

insert into public.app_permissions (user_id, app, role)
select id, 'verify-test', 'admin'
  from auth.users
 order by created_at
 limit 1
on conflict (user_id, app) do update set role = 'admin';

set local role supabase_auth_admin;

do $$
declare
  target uuid;
  apps   jsonb;
begin
  select user_id into target
    from public.app_permissions
   where app = 'verify-test';

  if target is null then
    raise exception
      'FAILED: supabase_auth_admin cannot read app_permissions. The select grant or the RLS policy is missing -- this is exactly what produces empty claims.';
  end if;

  apps := public.custom_access_token_hook(
            jsonb_build_object(
              'user_id', target::text,
              'claims',  jsonb_build_object('sub', target::text, 'aud', 'authenticated')
            )
          ) -> 'claims' -> 'app_metadata' -> 'apps';

  if apps is null then
    raise exception 'FAILED: hook returned no app_metadata.apps at all (jsonb path guard is wrong)';
  end if;

  if apps = '{}'::jsonb then
    raise exception 'FAILED: hook returned empty permissions despite a matching grant -- RLS is filtering the hook''s read';
  end if;

  if apps ->> 'verify-test' <> 'admin' then
    raise exception 'FAILED: expected verify-test=admin, got %', apps::text;
  end if;

  raise notice 'OK: access token hook produced %', apps::text;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. The table is not reachable by app-facing roles.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.app_permissions', 'select') then
    raise exception 'FAILED: authenticated can select app_permissions -- it should be unreachable over the API';
  end if;
  if has_table_privilege('anon', 'public.app_permissions', 'select') then
    raise exception 'FAILED: anon can select app_permissions';
  end if;

  raise notice 'OK: app_permissions is not readable by anon or authenticated';
end $$;

rollback;
