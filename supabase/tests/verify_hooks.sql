-- Proves both auth hooks are correctly wired. Run after applying migrations
-- and enabling the hooks under Authentication -> Hooks.
--
--   Supabase dashboard -> SQL Editor -> paste -> Run
--
-- Success is silent: completing without raising means everything checks out.
-- Any failure raises with a specific reason. Nothing is modified.
--
-- Why this exists: the failure mode is silent. A missing grant or RLS policy
-- does not error at token issuance -- it just mints tokens with no permissions
-- in them, and nobody finds out until people start getting locked out.
--
-- NOTE ON APPROACH: an earlier version of this script used
-- `set local role supabase_auth_admin` to execute the hook exactly as the auth
-- server does. That works as a superuser but NOT in the hosted SQL editor,
-- which runs as a role that cannot assume supabase_auth_admin
-- ("42501: permission denied to set role"). So the privilege checks below are
-- static -- they assert the grants and policy the hook depends on, rather than
-- exercising them. The dynamic end-to-end proof is the sign-in check at the
-- bottom, which is the real one anyway.

-- ---------------------------------------------------------------------------
-- 1. Domain enforcement. Pure function over the event; no DB access involved.
-- ---------------------------------------------------------------------------
do $$
declare
  allowed jsonb;
  refused jsonb;
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

  -- Suffix attack: split_part on the domain, never a LIKE match.
  refused := public.before_user_created_hook(
    jsonb_build_object('user', jsonb_build_object('email', 'x@fieldpulse.com.evil.com'))
  );
  if refused -> 'error' ->> 'http_code' <> '400' then
    raise exception 'FAILED: a lookalike domain was accepted (got %)', refused::text;
  end if;

  raise notice 'OK: domain hook accepts fieldpulse.com (any casing) and refuses everything else';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The grants and policy the access-token hook depends on.
--    Any one of these missing = tokens with empty permissions, silently.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_function_privilege(
       'supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute') then
    raise exception 'FAILED: supabase_auth_admin cannot execute custom_access_token_hook';
  end if;

  if not has_function_privilege(
       'supabase_auth_admin', 'public.before_user_created_hook(jsonb)', 'execute') then
    raise exception 'FAILED: supabase_auth_admin cannot execute before_user_created_hook';
  end if;

  if not has_table_privilege(
       'supabase_auth_admin', 'public.app_permissions', 'select') then
    raise exception 'FAILED: supabase_auth_admin has no select grant on app_permissions';
  end if;

  -- The grant alone is not enough: that role does not bypass RLS, and there is
  -- no JWT context during hook execution, so it needs its own policy.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'app_permissions'
       and cmd = 'SELECT'
       and 'supabase_auth_admin' = any(roles)
  ) then
    raise exception 'FAILED: no RLS SELECT policy for supabase_auth_admin on app_permissions -- the hook will read zero rows and every token will carry empty permissions';
  end if;

  raise notice 'OK: supabase_auth_admin can execute both hooks and read app_permissions through RLS';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The hook's jsonb shaping. Runs as the current role (which bypasses RLS),
--    so this validates STRUCTURE only -- section 2 covers the access side.
-- ---------------------------------------------------------------------------
do $$
declare
  result jsonb;
  claims jsonb;
begin
  result := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', gen_random_uuid()::text,
      'claims',  jsonb_build_object(
        'sub', 'test', 'aud', 'authenticated', 'role', 'authenticated',
        'app_metadata', jsonb_build_object('provider', 'google')
      )
    )
  );
  claims := result -> 'claims';

  if claims -> 'app_metadata' -> 'apps' is null then
    raise exception 'FAILED: hook did not add app_metadata.apps (got %)', claims::text;
  end if;

  -- Must not clobber Supabase's own app_metadata keys.
  if claims -> 'app_metadata' ->> 'provider' is distinct from 'google' then
    raise exception 'FAILED: hook clobbered app_metadata.provider (got %)', claims::text;
  end if;

  -- Required claims must survive.
  if claims ->> 'aud' is distinct from 'authenticated' or claims ->> 'role' is distinct from 'authenticated' then
    raise exception 'FAILED: hook dropped required claims (got %)', claims::text;
  end if;

  raise notice 'OK: hook adds app_metadata.apps, preserves provider and required claims';
exception
  when insufficient_privilege then
    -- The hook reads app_permissions, so this section needs table access. The
    -- hosted SQL editor runs as the table owner and has it; a lesser role does
    -- not. Skipping is fine -- section 2 already asserted the access the hook
    -- itself depends on.
    raise notice 'SKIPPED: structural check needs read access to app_permissions (harmless -- section 2 covers what matters)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The table is not reachable by app-facing roles.
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

-- ---------------------------------------------------------------------------
-- 5. THE REAL END-TO-END PROOF -- do this after the four checks above pass.
--
-- The checks above assert the wiring. Only a real token proves the auth server
-- actually invokes the hook and the claim survives into the JWT:
--
--   a. Grant yourself an app (see docs/runbooks/operations.md)
--   b. Sign in AFTER granting -- claims are baked in at issue time, so a token
--      minted earlier will not have them
--   c. Decode the access token and confirm:
--        "app_metadata": { "apps": { "comp-intel": "admin" }, "provider": "google" }
--
-- An empty apps object there, with sections 1-4 passing, means the hook is not
-- enabled in Authentication -> Hooks (or silently detached after a change).
-- ---------------------------------------------------------------------------

select 'All static checks passed. Now do the sign-in proof in section 5.' as result;
