-- =====================================================================
-- 00001_schema.sql
-- Inventory Management System: tables, indexes, triggers
-- =====================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text,
  permissions jsonb default '{}'::jsonb,
  is_system   boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- PROFILES (mirror of auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique,
  full_name  text,
  email      text,
  role_id    uuid references public.roles(id) on delete set null,
  status     text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- ITEMS (raw materials / inventory items)
-- ---------------------------------------------------------------------
create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  category      text,
  unit          text default 'pcs',
  description   text,
  cost_price    numeric(14,2) default 0,
  current_stock numeric(14,2) default 0,
  min_stock     numeric(14,2) default 0,
  status        text default 'active',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists items_name_idx on public.items (name);
create index if not exists items_status_idx on public.items (status);

-- ---------------------------------------------------------------------
-- PRODUCTS (finished goods, optional bill of materials)
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,
  name           text not null,
  category       text,
  sku            text,
  barcode        text,
  unit           text default 'pcs',
  cost_price     numeric(14,2) default 0,
  selling_price  numeric(14,2) default 0,
  current_stock  numeric(14,2) default 0,
  min_stock      numeric(14,2) default 0,
  bom            jsonb default '[]'::jsonb,    -- [{itemId, qty}]
  status         text default 'active',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists products_name_idx on public.products (name);
create index if not exists products_status_idx on public.products (status);

-- ---------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  email        text,
  phone        text,
  address      text,
  city         text,
  country      text,
  tax_id       text,
  credit_limit numeric(14,2) default 0,
  balance      numeric(14,2) default 0,
  status       text default 'active',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists customers_name_idx on public.customers (name);

-- ---------------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  email         text,
  phone         text,
  address       text,
  city          text,
  country       text,
  tax_id        text,
  payment_terms text default 'Net 30',
  balance       numeric(14,2) default 0,
  status        text default 'active',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists suppliers_name_idx on public.suppliers (name);

-- ---------------------------------------------------------------------
-- SALES
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id          uuid primary key default gen_random_uuid(),
  invoice_no  text unique not null,
  date        date default current_date,
  customer_id uuid references public.customers(id) on delete restrict,
  items       jsonb default '[]'::jsonb,        -- [{refId,name,qty,price}]
  subtotal    numeric(14,2) default 0,
  discount    numeric(14,2) default 0,
  tax_rate    numeric(6,2)  default 0,
  tax         numeric(14,2) default 0,
  total       numeric(14,2) default 0,
  status      text default 'draft',             -- draft|confirmed|paid|cancelled
  notes       text,
  created_at  timestamptz default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create index if not exists sales_date_idx on public.sales (date desc);
create index if not exists sales_status_idx on public.sales (status);

-- ---------------------------------------------------------------------
-- PURCHASES
-- ---------------------------------------------------------------------
create table if not exists public.purchases (
  id          uuid primary key default gen_random_uuid(),
  po_no       text unique not null,
  date        date default current_date,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  items       jsonb default '[]'::jsonb,
  subtotal    numeric(14,2) default 0,
  discount    numeric(14,2) default 0,
  tax_rate    numeric(6,2)  default 0,
  tax         numeric(14,2) default 0,
  total       numeric(14,2) default 0,
  status      text default 'draft',             -- draft|ordered|received|paid|cancelled
  notes       text,
  created_at  timestamptz default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create index if not exists purchases_date_idx on public.purchases (date desc);
create index if not exists purchases_status_idx on public.purchases (status);

-- ---------------------------------------------------------------------
-- SETTINGS (singleton row)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id         int primary key default 1,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint settings_singleton check (id = 1)
);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  t text;
begin
  for t in select unnest(array['roles','profiles','items','products','customers','suppliers','settings']) loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permission check function (used in RLS)
-- ---------------------------------------------------------------------
create or replace function public.has_permission(p_uid uuid, p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (r.permissions -> p_module ->> p_action)::boolean
     from profiles p
     join roles r on r.id = p.role_id
     where p.id = p_uid and p.status = 'active'),
    false
  );
$$;
grant execute on function public.has_permission(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Auto-create profile on auth.users insert.
-- The very first user is auto-promoted to Administrator.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role uuid;
  v_first      boolean;
begin
  select count(*) = 0 into v_first from public.profiles;
  if v_first then
    select id into v_admin_role from public.roles where name = 'Administrator' limit 1;
  end if;

  insert into public.profiles (id, username, full_name, email, role_id, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    v_admin_role,
    'active'
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
