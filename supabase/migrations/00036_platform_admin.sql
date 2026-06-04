-- ============================================================================
-- 00036: Platform administration (super-admin / tenant management)
--
-- Adds a cross-tenant control plane on top of the shared-schema model:
--   * tenants.status — active | read_only | suspended | locked (+ reason/audit)
--   * platform_admins — global super-admins (NOT tenant-scoped); they manage
--     every tenant. Membership is checked by the /platform console.
--   * platform_audit — immutable record of every platform-admin action.
--   * platform_tenant_overview() — one round-trip per-tenant health/usage rollup
--     used by the console (security definer; aggregates across all tenants).
--
-- These tables are deliberately NOT tenant-scoped. RLS is enabled with NO
-- policies so anon/authenticated clients see nothing; only the service-role
-- key (used by the platform console server code) can read/write them.
-- Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tenant lifecycle status
-- ----------------------------------------------------------------------------
alter table public.tenants add column if not exists status            text not null default 'active';
alter table public.tenants add column if not exists status_reason     text;
alter table public.tenants add column if not exists status_changed_at timestamptz;
alter table public.tenants add column if not exists status_changed_by uuid;
alter table public.tenants add column if not exists plan              text;
alter table public.tenants add column if not exists notes             text;

do $$ begin
  alter table public.tenants
    add constraint tenants_status_chk
    check (status in ('active','read_only','suspended','locked'));
exception when duplicate_object then null; end $$;

-- Any pre-existing tenants are active.
update public.tenants set status = 'active' where status is null;

-- ----------------------------------------------------------------------------
-- 2. Platform admins (global super-admins)
-- ----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.platform_admins enable row level security;
-- No policies → only service_role (which bypasses RLS) can touch this table.

-- ----------------------------------------------------------------------------
-- 3. Platform audit trail
-- ----------------------------------------------------------------------------
create table if not exists public.platform_audit (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid,
  admin_email text,
  action      text not null,
  tenant_id   uuid,
  tenant_name text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists platform_audit_created_idx on public.platform_audit (created_at desc);
create index if not exists platform_audit_tenant_idx  on public.platform_audit (tenant_id);
alter table public.platform_audit enable row level security;
-- No policies → service_role only.

-- ----------------------------------------------------------------------------
-- 4. Helper: is a user a platform admin?
-- ----------------------------------------------------------------------------
create or replace function public.is_platform_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where id = p_uid);
$$;
revoke all on function public.is_platform_admin(uuid) from public, anon;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Cross-tenant usage / health rollup
-- ----------------------------------------------------------------------------
create or replace function public.platform_tenant_overview()
returns table (
  id              uuid,
  name            text,
  slug            text,
  status          text,
  status_reason   text,
  created_at      timestamptz,
  users           bigint,
  products        bigint,
  customers       bigint,
  suppliers       bigint,
  sales           bigint,
  sales_total     numeric,
  purchases       bigint,
  purchases_total numeric,
  last_activity   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.name, t.slug, t.status, t.status_reason, t.created_at,
    (select count(*) from public.profiles  p  where p.tenant_id  = t.id),
    (select count(*) from public.products   pr where pr.tenant_id = t.id),
    (select count(*) from public.customers  c  where c.tenant_id  = t.id),
    (select count(*) from public.suppliers  s  where s.tenant_id  = t.id),
    (select count(*) from public.sales      sa where sa.tenant_id = t.id),
    coalesce((select sum(sa.total) from public.sales     sa where sa.tenant_id = t.id), 0),
    (select count(*) from public.purchases  pu where pu.tenant_id = t.id),
    coalesce((select sum(pu.total) from public.purchases pu where pu.tenant_id = t.id), 0),
    (select max(al.created_at) from public.activity_log al where al.tenant_id = t.id)
  from public.tenants t
  order by t.created_at;
$$;
revoke all on function public.platform_tenant_overview() from public, anon, authenticated;
grant execute on function public.platform_tenant_overview() to service_role;
