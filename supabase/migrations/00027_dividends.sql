-- ============================================================================
-- 00027: Dividends — declare & pay  [Phase 3]
--
-- * dividend_declarations — a declared dividend (total, rate, period)
-- * dividend_lines        — each shareholder's share (split by ownership %)
-- * dividend_payouts      — money paid out against a shareholder's share
--
-- Journals:
--   Declare: Dr Retained Earnings (3100)  Cr Dividends Payable (2400)
--   Payout:  Dr Dividends Payable (2400)  Cr Cash/Bank
--
-- Reuses the `equity` permission module. Settings hold the default rate +
-- frequency (jsonb, no schema change). Tenant-isolated. Idempotent.
-- ============================================================================

create table if not exists public.dividend_declarations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid default public.current_tenant_id(),
  declaration_no   text,
  date             date not null default current_date,
  period_label     text,
  rate             numeric(7,3) not null default 0,
  base_amount      numeric(14,2) not null default 0,
  total_amount     numeric(14,2) not null,
  status           text not null default 'active' check (status in ('active','cancelled')),
  journal_entry_id uuid references public.journal_entries(id),
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

create table if not exists public.dividend_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid default public.current_tenant_id(),
  declaration_id uuid not null references public.dividend_declarations(id) on delete cascade,
  shareholder_id uuid not null references public.shareholders(id),
  ownership_pct  numeric(6,3) not null default 0,
  amount         numeric(14,2) not null
);

create table if not exists public.dividend_payouts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  payout_no         text,
  declaration_id    uuid not null references public.dividend_declarations(id) on delete cascade,
  shareholder_id    uuid not null references public.shareholders(id),
  date              date not null default current_date,
  amount            numeric(14,2) not null,
  payment_method_id uuid references public.payment_methods(id),
  journal_entry_id  uuid references public.journal_entries(id),
  status            text not null default 'posted' check (status in ('posted','cancelled')),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists div_decl_tenant_idx on public.dividend_declarations (tenant_id);
create index if not exists div_lines_tenant_idx on public.dividend_lines (tenant_id);
create index if not exists div_lines_decl_idx on public.dividend_lines (declaration_id);
create index if not exists div_payouts_tenant_idx on public.dividend_payouts (tenant_id);
create index if not exists div_payouts_decl_idx on public.dividend_payouts (declaration_id);

do $$
declare t text;
begin
  foreach t in array array['dividend_declarations','dividend_lines','dividend_payouts'] loop
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

-- numbering + default dividend settings (rate %, frequency) ------------------
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextDividend}', '1'::jsonb, true)
where (data #> '{numbering,nextDividend}') is null;

update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{dividend}',
  '{"rate": 0, "frequency": "yearly"}'::jsonb, true)
where (data #> '{dividend}') is null;
