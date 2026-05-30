-- 00013_stock_adjustments.sql
-- Add accounts for stock loss / write-off, and a stock_adjustments audit table.

insert into public.accounts (code, name, type, is_system, is_active, description)
values
  ('5700', 'Inventory Adjustment', 'expense', true, true, 'Stock shrinkage, damage, count corrections (negative side debits this, positive side credits it).'),
  ('5800', 'Inventory Write-off',  'expense', true, true, 'Permanent removal of stock (expiry, obsolescence).')
on conflict (code) do nothing;

create table if not exists public.stock_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products(id),
  qty_change          numeric(14,4) not null,                  -- negative = stock down, positive = stock up
  reason              text not null,                            -- 'shrinkage', 'damage', 'count', 'write_off', 'found', 'internal_use', 'other'
  account_code        text not null default '5700',             -- chart-of-accounts code on the non-inventory side
  unit_cost           numeric(14,2) not null default 0,
  total_value         numeric(14,2) not null default 0,
  notes               text,
  journal_entry_id    uuid references public.journal_entries(id),
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index if not exists stock_adjustments_product_idx on public.stock_adjustments (product_id);
create index if not exists stock_adjustments_created_idx on public.stock_adjustments (created_at desc);

alter table public.stock_adjustments enable row level security;

-- View: products view permission
drop policy if exists stock_adjustments_select on public.stock_adjustments;
create policy stock_adjustments_select on public.stock_adjustments for select
  using (public.has_permission(auth.uid(), 'products','view'));

-- Insert: products edit permission
drop policy if exists stock_adjustments_insert on public.stock_adjustments;
create policy stock_adjustments_insert on public.stock_adjustments for insert
  with check (public.has_permission(auth.uid(), 'products','edit'));
