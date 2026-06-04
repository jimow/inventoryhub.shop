-- ============================================================================
-- 00037: Remote deployment + workspace deletion
--
--   * platform_servers     — remote machines the console can deploy to (SSH).
--     SSH secrets are stored ENCRYPTED (AES-256-GCM) by the app, never plain.
--   * platform_deployments — history + live log of each deploy run.
--   * platform_delete_tenant() — completely removes a workspace: every row in
--     every public table carrying its tenant_id, then the tenant itself.
--
-- New tables are service-role only (RLS on, no policies). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remote servers
-- ----------------------------------------------------------------------------
create table if not exists public.platform_servers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  host          text not null,
  port          integer not null default 22,
  ssh_user      text not null default 'root',
  auth_method   text not null default 'key',         -- 'key' | 'password'
  secret_cipher text,                                 -- encrypted private key or password
  app_dir       text not null default '/opt/inventory',
  repo_url      text,                                 -- optional git source
  branch        text default 'main',
  app_port      integer not null default 3000,
  base_url      text,                                 -- public URL once deployed
  status        text not null default 'unknown',      -- unknown | online | offline | error
  last_checked  timestamptz,
  last_result   text,
  created_at    timestamptz not null default now(),
  created_by    uuid
);
alter table public.platform_servers enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Deployment runs
-- ----------------------------------------------------------------------------
create table if not exists public.platform_deployments (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid references public.platform_servers(id) on delete set null,
  server_name text,
  tenant_id   uuid,
  tenant_name text,
  status      text not null default 'running',        -- running | success | failed
  step        text,
  log         text not null default '',
  app_port    integer,
  base_url    text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  created_by  uuid
);
create index if not exists platform_deployments_started_idx on public.platform_deployments (started_at desc);
alter table public.platform_deployments enable row level security;

-- ----------------------------------------------------------------------------
-- 3. Hard-delete a workspace and ALL its data
-- ----------------------------------------------------------------------------
create or replace function public.platform_delete_tenant(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_round  int := 0;
  v_rows   bigint;
  v_total  bigint;
begin
  if p_tenant is null then raise exception 'tenant id is required'; end if;

  -- Iterate: delete rows from every tenant-scoped table. Retry across rounds so
  -- foreign-key ordering resolves itself (dependents get removed first).
  loop
    v_round := v_round + 1;
    v_total := 0;
    for r in
      select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public'
        and c.column_name = 'tenant_id'
        and t.table_type = 'BASE TABLE'
        and c.table_name <> 'tenants'
    loop
      begin
        execute format('delete from public.%I where tenant_id = $1', r.table_name) using p_tenant;
        get diagnostics v_rows = row_count;
        v_total := v_total + v_rows;
      exception when others then
        -- FK ordering or transient issue — try again next round.
        null;
      end;
    end loop;
    exit when v_total = 0 or v_round > 25;
  end loop;

  delete from public.tenants where id = p_tenant;
end
$$;
revoke all on function public.platform_delete_tenant(uuid) from public, anon, authenticated;
grant execute on function public.platform_delete_tenant(uuid) to service_role;
