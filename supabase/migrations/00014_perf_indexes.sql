-- 00014_perf_indexes.sql
-- Indexes for the hottest queries in detail pages, list filters, and dashboard.

-- Customer detail: sales.customer_id + sales.date filter
create index if not exists sales_customer_id_idx        on public.sales (customer_id);
create index if not exists sales_status_date_idx        on public.sales (status, date desc);
create index if not exists sales_due_date_idx           on public.sales (due_date)
  where due_date is not null and status not in ('paid', 'cancelled');

-- Supplier detail
create index if not exists purchases_supplier_id_idx    on public.purchases (supplier_id);
create index if not exists purchases_status_date_idx    on public.purchases (status, date desc);
create index if not exists purchases_due_date_idx       on public.purchases (due_date)
  where due_date is not null and status not in ('paid', 'cancelled');

-- Payments lookup (customer / supplier history + receipts page)
create index if not exists payments_direction_date_idx  on public.payments (direction, date desc);
create index if not exists payments_customer_dir_idx    on public.payments (customer_id, direction)
  where customer_id is not null;
create index if not exists payments_supplier_dir_idx    on public.payments (supplier_id, direction)
  where supplier_id is not null;
create index if not exists payments_sale_idx2           on public.payments (sale_id)
  where sale_id is not null;
create index if not exists payments_purchase_idx2       on public.payments (purchase_id)
  where purchase_id is not null;

-- Product detail: stock_adjustments + inventory_units already indexed in 00009/00013
-- Just add a covering index for the journal_lines lookup that powers /reports
create index if not exists journal_lines_account_idx    on public.journal_lines (account_id);
create index if not exists journal_entries_date_idx     on public.journal_entries (date desc);

-- Customers/Suppliers list search by name (used by combobox)
create index if not exists customers_name_idx           on public.customers (lower(name));
create index if not exists suppliers_name_idx           on public.suppliers (lower(name));

-- Products list: by code/sku/barcode (used by POS scanner + global search)
create index if not exists products_code_idx            on public.products (lower(code));
create index if not exists products_sku_idx             on public.products (lower(sku))
  where sku is not null;
create index if not exists products_barcode_idx         on public.products (lower(barcode))
  where barcode is not null;
