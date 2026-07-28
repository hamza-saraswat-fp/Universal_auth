-- The authorization source of truth: who can use which internal app, and as what.
--
-- Granting access is one insert, revoking is one delete. Changes take effect on
-- the user's next token refresh, since roles are carried in the JWT rather than
-- looked up per request.

create table public.app_permissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  app        text not null,
  role       text not null default 'member',
  created_at timestamptz not null default now(),

  unique (user_id, app),

  -- The package types roles as exactly 'member' | 'admin'. Without this the
  -- type is a lie the moment someone inserts something else by hand.
  constraint app_permissions_role_valid check (role in ('member', 'admin')),

  -- App slugs ride in a cookie on every request and are compared verbatim by
  -- requireApp(). Keep them short, lowercase, and free of surprises.
  constraint app_permissions_app_valid check (app ~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$')
);

comment on table public.app_permissions is
  'Who may use which internal app. Read by custom_access_token_hook() at token issuance; not exposed to apps, which read roles from the verified JWT instead.';

alter table public.app_permissions enable row level security;

-- The access token hook runs as supabase_auth_admin, which does NOT bypass RLS
-- and has no JWT context (auth.uid() is null). Without this policy the hook's
-- select matches zero rows and every token is issued with empty permissions --
-- silently, with no error anywhere.
create policy "auth admin reads all permissions"
  on public.app_permissions
  as permissive
  for select
  to supabase_auth_admin
  using (true);

-- No policy for anon or authenticated, deliberately. Apps read a user's roles
-- from the verified JWT, never by querying this project, so exposing this table
-- over the API would add surface area for no benefit. The grants in the next
-- migration make that explicit; RLS staying enabled means it still holds if a
-- grant is ever added.

-- The unique (user_id, app) index already covers the hook's lookup by user_id,
-- so no additional index is needed.
