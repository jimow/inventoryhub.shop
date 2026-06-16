-- ============================================================================
-- 00041: Quotations / quotes
--
-- A quotation is a non-binding price offer to a customer. It mirrors the shape
-- of a sale (same JSONB `items` line model) but never touches stock or the
-- ledger. When the customer accepts, the quote is CONVERTED into a draft sale
-- (converted_sale_id links the two) which then follows the normal sale flow.
--
-- Tenant-isolated exactly like every other table (restrictive RLS +
-- has_permission gate on a new `quotations` module).
-- ============================================================================

create table if not exists public.quotations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  quote_no          text not null,
  date              date not null default current_date,
  valid_until       date,
  customer_id       uuid references public.customers(id) on delete restrict,
  items             jsonb not null default '[]'::jsonb,        -- [{refId,name,qty,price,taxable}]
  subtotal          numeric(14,2) not null default 0,
  discount          numeric(14,2) not null default 0,
  tax_rate          numeric(6,2)  not null default 0,
  tax               numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  status            text not null default 'draft'
                      check (status in ('draft','sent','accepted','converted','rejected','expired')),
  converted_sale_id uuid references public.sales(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null
);

create index if not exists quotations_tenant_idx   on public.quotations (tenant_id);
create index if not exists quotations_date_idx      on public.quotations (date desc);
create index if not exists quotations_status_idx    on public.quotations (status);
create index if not exists quotations_customer_idx  on public.quotations (customer_id);

-- A quote number is unique within a tenant (not globally).
create unique index if not exists quotations_tenant_quote_no_uidx
  on public.quotations (tenant_id, quote_no);

-- tenant isolation + permission-gated access ---------------------------------
alter table public.quotations enable row level security;
grant select, insert, update, delete on public.quotations to authenticated;
grant all on public.quotations to service_role;

drop policy if exists quotations_tenant_isolation on public.quotations;
create policy quotations_tenant_isolation on public.quotations as restrictive to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists quotations_rw on public.quotations;
create policy quotations_rw on public.quotations for all to authenticated
  using (public.has_permission(auth.uid(), 'quotations', 'view'))
  with check (public.has_permission(auth.uid(), 'quotations', 'create'));

-- numbering counter ----------------------------------------------------------
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextQuotation}', '1'::jsonb, true)
where (data #> '{numbering,nextQuotation}') is null;

-- grant the new `quotations` module to Administrator on every tenant ----------
update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{quotations}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';
