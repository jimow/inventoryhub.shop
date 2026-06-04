-- ============================================================================
-- 00033: Sales returns & purchase returns (with stock + double-entry journals)
--
-- sales_return    — customer returns goods: stock back in, revenue reversed,
--                   COGS reversed, refund as cash OR credit to the customer.
-- purchase_return — we return goods to a supplier: stock out, inventory + input
--                   tax reversed, settled against A/P OR a cash refund.
-- Tenant-isolated exactly like every other table (restrictive RLS + has_permission).
-- ============================================================================

create table if not exists public.sales_returns (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  return_no         text,
  sale_id           uuid references public.sales(id),
  customer_id       uuid references public.customers(id),
  date              date not null default current_date,
  items             jsonb not null default '[]'::jsonb,
  subtotal          numeric(14,2) not null default 0,
  tax               numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  refund_method     text not null default 'credit' check (refund_method in ('cash','credit')),
  payment_method_id uuid references public.payment_methods(id),
  notes             text,
  status            text not null default 'posted' check (status in ('posted','cancelled')),
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create table if not exists public.purchase_returns (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  return_no         text,
  purchase_id       uuid references public.purchases(id),
  supplier_id       uuid references public.suppliers(id),
  date              date not null default current_date,
  items             jsonb not null default '[]'::jsonb,
  subtotal          numeric(14,2) not null default 0,
  tax               numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  refund_method     text not null default 'balance' check (refund_method in ('cash','balance')),
  payment_method_id uuid references public.payment_methods(id),
  notes             text,
  status            text not null default 'posted' check (status in ('posted','cancelled')),
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists sales_returns_tenant_idx on public.sales_returns (tenant_id);
create index if not exists sales_returns_sale_idx on public.sales_returns (sale_id);
create index if not exists purchase_returns_tenant_idx on public.purchase_returns (tenant_id);
create index if not exists purchase_returns_po_idx on public.purchase_returns (purchase_id);

-- tenant isolation + permission-gated access ---------------------------------
do $$
declare rec record;
begin
  for rec in
    select 'sales_returns'::text as tbl, 'returns'::text as mod
    union all select 'purchase_returns', 'returns'
  loop
    execute format('alter table public.%I enable row level security', rec.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', rec.tbl);
    execute format('grant all on public.%I to service_role', rec.tbl);
    execute format('drop policy if exists %I on public.%I', rec.tbl || '_tenant_isolation', rec.tbl);
    execute format($f$
      create policy %I on public.%I as restrictive to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())
    $f$, rec.tbl || '_tenant_isolation', rec.tbl);
    execute format('drop policy if exists %I on public.%I', rec.tbl || '_rw', rec.tbl);
    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (public.has_permission(auth.uid(), %L, 'view'))
      with check (public.has_permission(auth.uid(), %L, 'create'))
    $f$, rec.tbl || '_rw', rec.tbl, rec.mod, rec.mod);
  end loop;
end $$;

-- numbering counters --------------------------------------------------------
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextSalesReturn}', '1'::jsonb, true)
where (data #> '{numbering,nextSalesReturn}') is null;
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextPurchaseReturn}', '1'::jsonb, true)
where (data #> '{numbering,nextPurchaseReturn}') is null;

-- grant the new `returns` module to Administrator on every tenant ------------
update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{returns}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';

-- Sales Returns contra-revenue account (4050) for existing tenants -----------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'tenants') then
    insert into public.accounts (tenant_id, code, name, type, is_system, is_active)
    select t.id, '4050', 'Sales Returns', 'income', true, true
    from public.tenants t
    where not exists (
      select 1 from public.accounts a where a.tenant_id = t.id and a.code = '4050'
    );
  end if;
end $$;
