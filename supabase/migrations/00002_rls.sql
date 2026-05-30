-- =====================================================================
-- 00002_rls.sql
-- Row Level Security policies. Each table allows operations based on
-- has_permission(auth.uid(), '<module>', '<action>')
-- =====================================================================

-- Enable RLS on all relevant tables
alter table public.roles      enable row level security;
alter table public.profiles   enable row level security;
alter table public.items      enable row level security;
alter table public.products   enable row level security;
alter table public.customers  enable row level security;
alter table public.suppliers  enable row level security;
alter table public.sales      enable row level security;
alter table public.purchases  enable row level security;
alter table public.settings   enable row level security;

-- ---------------------------------------------------------------------
-- Helper: drop policy if exists, then create
-- ---------------------------------------------------------------------
do $$ begin
  -- noop, we will use IF EXISTS in DROP statements below
end $$;

-- ---------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
drop policy if exists roles_insert on public.roles;
drop policy if exists roles_update on public.roles;
drop policy if exists roles_delete on public.roles;

-- Anyone authenticated can SELECT roles (needed to look up role names in UI)
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_insert on public.roles for insert to authenticated
  with check (public.has_permission(auth.uid(), 'roles', 'create'));
create policy roles_update on public.roles for update to authenticated
  using      (public.has_permission(auth.uid(), 'roles', 'edit'))
  with check (public.has_permission(auth.uid(), 'roles', 'edit'));
create policy roles_delete on public.roles for delete to authenticated
  using (public.has_permission(auth.uid(), 'roles', 'delete') and is_system = false);

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;

-- A user can always see their own profile; users.view permission grants seeing all
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission(auth.uid(), 'users', 'view'));

-- Update: self (limited columns enforced at app layer) OR users.edit permission
create policy profiles_update on public.profiles for update to authenticated
  using      (id = auth.uid() or public.has_permission(auth.uid(), 'users', 'edit'))
  with check (id = auth.uid() or public.has_permission(auth.uid(), 'users', 'edit'));

create policy profiles_delete on public.profiles for delete to authenticated
  using (public.has_permission(auth.uid(), 'users', 'delete') and id <> auth.uid());

-- Inserts come via the auth trigger only — no direct insert policy needed.

-- ---------------------------------------------------------------------
-- Generic CRUD policies for module tables
-- ---------------------------------------------------------------------
do $$
declare
  t   text;
  mod text;
begin
  for t, mod in
    select * from (values
      ('items','items'),
      ('products','products'),
      ('customers','customers'),
      ('suppliers','suppliers'),
      ('sales','sales'),
      ('purchases','purchases')
    ) as v(t, mod)
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($f$
      create policy %I on public.%I for select to authenticated
      using (public.has_permission(auth.uid(), %L, 'view'))
    $f$, t || '_select', t, mod);

    execute format($f$
      create policy %I on public.%I for insert to authenticated
      with check (public.has_permission(auth.uid(), %L, 'create'))
    $f$, t || '_insert', t, mod);

    execute format($f$
      create policy %I on public.%I for update to authenticated
      using      (public.has_permission(auth.uid(), %L, 'edit'))
      with check (public.has_permission(auth.uid(), %L, 'edit'))
    $f$, t || '_update', t, mod, mod);

    execute format($f$
      create policy %I on public.%I for delete to authenticated
      using (public.has_permission(auth.uid(), %L, 'delete'))
    $f$, t || '_delete', t, mod);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- SETTINGS (single row)
-- ---------------------------------------------------------------------
drop policy if exists settings_select on public.settings;
drop policy if exists settings_update on public.settings;
drop policy if exists settings_insert on public.settings;

-- Any authenticated user can READ settings (so the app can render currency/format)
create policy settings_select on public.settings for select to authenticated using (true);

create policy settings_update on public.settings for update to authenticated
  using      (public.has_permission(auth.uid(), 'settings', 'edit'))
  with check (public.has_permission(auth.uid(), 'settings', 'edit'));

create policy settings_insert on public.settings for insert to authenticated
  with check (public.has_permission(auth.uid(), 'settings', 'edit'));
