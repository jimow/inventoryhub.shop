-- 00009_taxable_serials_cogs.sql
-- Three new product/item capabilities:
--   1. taxable           — only taxable lines count toward tax base
--   2. serial_tracked    — each unit is captured by serial / barcode
--   3. cost-of-goods-sold accounting — sale confirmation posts a COGS entry
--      using the cost_price of every line.

-- 1) FLAGS ----------------------------------------------------------
alter table public.items
  add column if not exists taxable        boolean not null default true,
  add column if not exists serial_tracked boolean not null default false;

alter table public.products
  add column if not exists taxable        boolean not null default true,
  add column if not exists serial_tracked boolean not null default false;

-- 2) INVENTORY UNITS (serial-level ledger) -------------------------
-- One row per physical unit. When a purchase is received we insert a row;
-- when a sale is confirmed we mark it sold. Stock for serial-tracked products
-- = count of units with status='in_stock'.
create table if not exists public.inventory_units (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references public.products(id) on delete restrict,
  item_id       uuid references public.items(id)    on delete restrict,
  serial_no     text not null,
  barcode       text,
  status        text not null default 'in_stock'
                check (status in ('in_stock','sold','scrapped','returned')),
  cost          numeric(14,2) not null default 0,
  purchase_id   uuid references public.purchases(id),
  purchase_line_idx int,
  sale_id       uuid references public.sales(id),
  sale_line_idx int,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- exactly one of product_id / item_id must be set
  constraint inventory_units_one_target
    check ((product_id is not null)::int + (item_id is not null)::int = 1)
);

-- A given serial is unique within its product/item.
create unique index if not exists inventory_units_product_serial_idx
  on public.inventory_units (product_id, serial_no)
  where product_id is not null;
create unique index if not exists inventory_units_item_serial_idx
  on public.inventory_units (item_id, serial_no)
  where item_id is not null;
create index if not exists inventory_units_status_idx on public.inventory_units (status);
create index if not exists inventory_units_barcode_idx on public.inventory_units (barcode);

alter table public.inventory_units enable row level security;

-- View: anyone with items OR products view permission can read serials.
drop policy if exists inventory_units_select on public.inventory_units;
create policy inventory_units_select on public.inventory_units for select
  using (
    public.has_permission(auth.uid(), 'items','view')
    or public.has_permission(auth.uid(), 'products','view')
  );

-- Insert/Update: anyone who can edit inventory (purchases or sales).
drop policy if exists inventory_units_insert on public.inventory_units;
create policy inventory_units_insert on public.inventory_units for insert
  with check (
    public.has_permission(auth.uid(), 'purchases','create')
    or public.has_permission(auth.uid(), 'purchases','edit')
    or public.has_permission(auth.uid(), 'sales','create')
    or public.has_permission(auth.uid(), 'sales','edit')
    or public.has_permission(auth.uid(), 'items','edit')
    or public.has_permission(auth.uid(), 'products','edit')
  );

drop policy if exists inventory_units_update on public.inventory_units;
create policy inventory_units_update on public.inventory_units for update
  using (
    public.has_permission(auth.uid(), 'sales','edit')
    or public.has_permission(auth.uid(), 'purchases','edit')
    or public.has_permission(auth.uid(), 'items','edit')
    or public.has_permission(auth.uid(), 'products','edit')
  );

-- 3) COGS account already exists (account 5000 from 00005). Nothing to add
-- here for the chart of accounts.

-- 4) (Optional) Helpful view: stock summary that prefers serial count for
-- serial-tracked products.
create or replace view public.product_stock as
select
  p.id,
  p.code,
  p.name,
  p.serial_tracked,
  case when p.serial_tracked
       then coalesce((select count(*) from public.inventory_units u
                       where u.product_id = p.id and u.status = 'in_stock'), 0)
       else p.current_stock
  end as effective_stock
from public.products p;

grant select on public.product_stock to authenticated;
