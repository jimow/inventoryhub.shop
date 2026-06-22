-- ============================================================================
-- 00042: Store (warehouse) vs Shop (sales floor) stock locations
--
-- Goods can be received into either the SHOP (immediately sellable) or the
-- STORE (back-room / warehouse). Only SHOP stock can be sold; STORE stock must
-- be transferred to the shop first.
--
--   products.current_stock  -> SHOP stock (sellable; unchanged semantics)
--   products.store_stock    -> STORE stock (held back; new)
--   total on hand           = current_stock + store_stock
--
-- Serial units carry their own location so individual units move with transfers.
-- A `stock_transfers` audit table records every store<->shop movement.
-- ============================================================================

alter table public.products
  add column if not exists store_stock numeric(14,2) not null default 0;

alter table public.inventory_units
  add column if not exists location text not null default 'shop'
    check (location in ('shop','store'));

create table if not exists public.stock_transfers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid default public.current_tenant_id(),
  product_id  uuid references public.products(id) on delete cascade,
  qty         numeric(14,2) not null,
  direction   text not null check (direction in ('to_shop','to_store')),
  date        date not null default current_date,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create index if not exists stock_transfers_tenant_idx  on public.stock_transfers (tenant_id);
create index if not exists stock_transfers_product_idx on public.stock_transfers (product_id);
create index if not exists stock_transfers_date_idx    on public.stock_transfers (date desc);

-- tenant isolation + permission-gated access (new `store` module) -------------
alter table public.stock_transfers enable row level security;
grant select, insert, update, delete on public.stock_transfers to authenticated;
grant all on public.stock_transfers to service_role;

drop policy if exists stock_transfers_tenant_isolation on public.stock_transfers;
create policy stock_transfers_tenant_isolation on public.stock_transfers as restrictive to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists stock_transfers_rw on public.stock_transfers;
create policy stock_transfers_rw on public.stock_transfers for all to authenticated
  using (public.has_permission(auth.uid(), 'store', 'view'))
  with check (public.has_permission(auth.uid(), 'store', 'create'));

-- grant the new `store` module to Administrator on every tenant ---------------
update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{store}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';
