-- ============================================================================
-- 00031: Transport & other charges on purchases (landed cost)
--
-- Freight / handling / other charges entered on a purchase are capitalized into
-- the inventory cost of the received items (split across lines by value), so
-- unit cost, COGS and stock valuation reflect the true landed cost. The charges
-- are added to the purchase total (owed to the supplier / paid with the PO).
-- Per-item charges live inside the items JSON (PurchaseLine.charge).
-- ============================================================================

alter table public.purchases add column if not exists transport_cost numeric not null default 0;
alter table public.purchases add column if not exists other_charges numeric not null default 0;
