-- Refuses any account outside the FieldPulse Google Workspace at signup.
--
-- Backstop, not the primary gate: the Google OAuth consent screen is set to
-- Internal, so Google itself rejects outside accounts before a request reaches
-- us. This is what holds if that setting is ever changed.
--
-- A hook rather than a trigger on auth.users: that schema is Supabase-owned
-- with restricted DDL, and a trigger's exception surfaces to the user as an
-- opaque "500 Database error saving new user" where this returns a readable
-- 400. It is also the shape the contractor allow-list (IAI-415) evolves into --
-- swap the literal below for a lookup against a domains table, same mechanism.

create or replace function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  -- The user row does not exist in Postgres yet, so the email comes off the
  -- event. Lowercased because the provider's casing is not guaranteed.
  user_email text := lower(event -> 'user' ->> 'email');
begin
  if user_email is null or split_part(user_email, '@', 2) <> 'fieldpulse.com' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Only fieldpulse.com accounts are allowed.'
      )
    );
  end if;

  -- Empty object means "allow"; anything under 'error' rejects the signup.
  return '{}'::jsonb;
end;
$$;

comment on function public.before_user_created_hook(jsonb) is
  'Auth hook: rejects signups outside fieldpulse.com. Must stay enabled under Authentication -> Hooks.';

grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created_hook(jsonb) from anon, authenticated, public;
