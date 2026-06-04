-- ============================================================================
-- 00025: Shareholders & equity contributions (Phase 1 of Capital & Financing)
--
-- * shareholders         — owners of the business + their ownership %
-- * equity_contributions — capital paid in / withdrawn, each posting a journal:
--     contribution: Dr <cash/bank asset>   Cr Owner Equity (3000)
--     withdrawal:   Dr Owner Equity (3000)  Cr <cash/bank asset>
--
-- New permission module `equity` gates the screen. Tenant-isolated like every
-- other table (shared-schema multi-tenancy). Idempotent.
-- ============================================================================

create table if not exists public.shareholders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid default public.current_tenant_id(),
  code          text,
  name          text not null,
  email         text,
  phone         text,
  ownership_pct numeric(6,3) not null default 0,   -- 0..100
  notes         text,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create table if not exists public.equity_contributions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  contribution_no   text,
  shareholder_id    uuid not null references public.shareholders(id) on delete cascade,
  date              date not null default current_date,
  kind              text not null default 'contribution'
                      check (kind in ('contribution','withdrawal')),
  amount            numeric(14,2) not null,
  payment_method_id uuid references public.payment_methods(id),
  journal_entry_id  uuid references public.journal_entries(id),
  status            text not null default 'posted'
                      check (status in ('posted','cancelled')),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists shareholders_tenant_idx on public.shareholders (tenant_id);
create index if not exists equity_contrib_tenant_idx on public.equity_contributions (tenant_id);
create index if not exists equity_contrib_shareholder_idx on public.equity_contributions (shareholder_id);

-- tenant isolation + access (mirrors the shared-tenancy pattern) -------------
do $$
declare t text;
begin
  foreach t in array array['shareholders','equity_contributions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_isolation', t);
    execute format($f$
      create policy %I on public.%I as restrictive to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())
    $f$, t || '_tenant_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (public.has_permission(auth.uid(), 'equity', 'view'))
      with check (public.has_permission(auth.uid(), 'equity', 'create'))
    $f$, t || '_rw', t);
  end loop;
end $$;

-- numbering counter for contributions (EQ-00001) ----------------------------
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextEquity}', '1'::jsonb, true)
where (data #> '{numbering,nextEquity}') is null;

-- grant the new `equity` module to Administrator on every tenant -------------
update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{equity}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';
