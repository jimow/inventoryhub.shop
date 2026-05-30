-- =====================================================================
-- 00004_polish.sql
-- Sale types (cash/credit/invoice), purchase types, payment tracking,
-- helpful indexes for filtering & pagination.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SALES: type, due date, amount paid (for partial payments)
-- ---------------------------------------------------------------------
alter table public.sales
  add column if not exists sale_type   text          default 'cash',  -- 'cash'|'credit'|'invoice'
  add column if not exists due_date    date,
  add column if not exists amount_paid numeric(14,2) default 0;

-- Backfill existing rows: cash if status='paid', credit otherwise
update public.sales
set sale_type = case when status = 'paid' then 'cash' else 'credit' end
where sale_type is null;

-- Set amount_paid for already-paid sales
update public.sales
set amount_paid = total
where status = 'paid' and amount_paid = 0;

-- Index for filtering
create index if not exists sales_sale_type_idx  on public.sales (sale_type);
create index if not exists sales_customer_idx   on public.sales (customer_id);
create index if not exists sales_due_date_idx   on public.sales (due_date);

-- ---------------------------------------------------------------------
-- PURCHASES: type, due date, amount paid
-- ---------------------------------------------------------------------
alter table public.purchases
  add column if not exists purchase_type text          default 'cash', -- 'cash'|'credit'
  add column if not exists due_date      date,
  add column if not exists amount_paid   numeric(14,2) default 0;

update public.purchases
set purchase_type = case when status = 'paid' then 'cash' else 'credit' end
where purchase_type is null;

update public.purchases
set amount_paid = total
where status = 'paid' and amount_paid = 0;

create index if not exists purchases_purchase_type_idx on public.purchases (purchase_type);
create index if not exists purchases_supplier_idx      on public.purchases (supplier_id);
create index if not exists purchases_due_date_idx      on public.purchases (due_date);

-- ---------------------------------------------------------------------
-- Helpful indexes for category / status filtering
-- ---------------------------------------------------------------------
create index if not exists items_category_idx     on public.items     (category);
create index if not exists products_category_idx  on public.products  (category);
create index if not exists customers_status_idx   on public.customers (status);
create index if not exists suppliers_status_idx   on public.suppliers (status);
