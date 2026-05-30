-- ============================================================================
-- 00020: Shared-schema multi-tenancy (tenant_id model)
--
-- Replaces schema-per-tenant. Every shop lives in the SAME `public` schema and
-- is isolated by a tenant_id column. `public` is always exposed to the API, so
-- the per-schema "Exposed schemas" problem disappears entirely.
--
-- How isolation works:
--   * Each deployment sends an `x-tenant-id` header on every request (set by
--     the app from TENANT_ID).
--   * current_tenant_id() reads that header.
--   * Every tenant table gets:
--       - tenant_id uuid  DEFAULT current_tenant_id()  → auto-tags inserts
--       - a RESTRICTIVE RLS policy `tenant_id = current_tenant_id()` that AND's
--         with the existing permission policies (so both must pass).
--   * Existing rows are backfilled to a "Default" tenant.
--
-- NOTE: the service_role key BYPASSES RLS, so service-role reads are NOT
-- filtered by this policy. Those are scoped in application code (Stage 2).
-- Idempotent.
-- ============================================================================

-- A legacy `tenants` registry may exist from the old schema-per-tenant
-- install.sql (columns: schema_name, company_name). It's incompatible with the
-- shared-tenancy shape, so drop it if it lacks the new `name` column.
do $$
begin
  if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'tenants')
     and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'tenants' and column_name = 'name')
  then
    drop table public.tenants cascade;
  end if;
end $$;

create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;

-- Reads the active tenant from the request header PostgREST exposes.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-id'),
    ''
  )::uuid
$$;
grant execute on function public.current_tenant_id() to anon, authenticated, service_role;

-- A default tenant to own any pre-existing rows.
insert into public.tenants (name, slug)
select 'Default', 'default'
where not exists (select 1 from public.tenants);

do $$
declare
  t              text;
  v_default      uuid;
begin
  select id into v_default from public.tenants order by created_at limit 1;

  for t in
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name <> 'tenants'
  loop
    -- 1. tenant_id column
    execute format('alter table public.%I add column if not exists tenant_id uuid', t);
    -- 2. backfill existing rows to the default tenant
    execute format('update public.%I set tenant_id = %L where tenant_id is null', t, v_default);
    -- 3. auto-tag future inserts from the request header
    execute format('alter table public.%I alter column tenant_id set default public.current_tenant_id()', t);
    -- 4. index for tenant-scoped lookups
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    -- 5. restrictive isolation policy (AND-ed with existing permission policies)
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_isolation', t);
    execute format($f$
      create policy %I on public.%I as restrictive to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())
    $f$, t || '_tenant_isolation', t);
  end loop;
end $$;
