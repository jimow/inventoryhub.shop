-- ============================================================================
-- 00035: System-wide activity / audit log
--
-- One row per business event (sale, purchase, payment, receipt, return, equity,
-- loan, dividend, stock adjustment, journal, …) capturing WHO did it, WHICH
-- module, a human summary, the amount, and WHEN. Tenant-isolated like every
-- other table. Gated by a new `audit` permission module.
-- ============================================================================

create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid default public.current_tenant_id(),
  user_id     uuid,
  user_name   text,
  module      text not null default 'system',
  action      text not null default 'event',
  summary     text,
  entity_type text,
  entity_id   uuid,
  amount      numeric,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_tenant_idx  on public.activity_log (tenant_id);
create index if not exists activity_log_created_idx on public.activity_log (tenant_id, created_at desc);
create index if not exists activity_log_module_idx  on public.activity_log (tenant_id, module);
create index if not exists activity_log_user_idx    on public.activity_log (tenant_id, user_id);

alter table public.activity_log enable row level security;
grant select, insert, update, delete on public.activity_log to authenticated;
grant all on public.activity_log to service_role;

drop policy if exists activity_log_tenant_isolation on public.activity_log;
create policy activity_log_tenant_isolation on public.activity_log as restrictive to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists activity_log_rw on public.activity_log;
create policy activity_log_rw on public.activity_log for all to authenticated
  using (public.has_permission(auth.uid(), 'audit', 'view'))
  with check (public.has_permission(auth.uid(), 'audit', 'create'));

-- grant the new `audit` module to Administrator on every tenant -------------
update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{audit}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';
