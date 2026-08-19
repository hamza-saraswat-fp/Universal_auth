-- Stamps each user's per-app roles into every access token they are issued, so
-- an app learns what someone may do by verifying a signature rather than by
-- calling back to this project.
--
-- Resulting claim:
--   { "app_metadata": { "apps": { "comp-intel": "admin" } } }
--
-- Roles go in app_metadata, never user_metadata -- user_metadata is writable by
-- the user, so trusting it for authorization would let anyone make themselves
-- an admin.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  perms  jsonb;
begin
  select coalesce(jsonb_object_agg(p.app, p.role), '{}'::jsonb)
    into perms
    from public.app_permissions p
   where p.user_id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  -- jsonb_set is a silent no-op when the parent path is missing, so the nested
  -- write below would do nothing if app_metadata were absent.
  if jsonb_typeof(claims -> 'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  claims := jsonb_set(claims, '{app_metadata,apps}', perms);

  return jsonb_set(event, '{claims}', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook: adds app_metadata.apps to every access token. Must stay enabled under Authentication -> Hooks, and keeps its grants below.';

-- Without these the hook cannot see the table it depends on, and every token is
-- issued with an empty apps claim -- no error, just missing permissions. This
-- block must travel with the function in the same migration.
grant usage on schema public to supabase_auth_admin;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;

-- Select only: the hook reads and never writes.
grant select on table public.app_permissions to supabase_auth_admin;
revoke all on table public.app_permissions from anon, authenticated;
