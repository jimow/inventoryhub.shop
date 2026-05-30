-- =====================================================================
-- 00003_seed.sql
-- Seed: default roles, default settings, sample items/products/contacts.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Default roles
-- ---------------------------------------------------------------------
with perms as (
  select
    -- Administrator: every module / every action
    jsonb_build_object(
      'dashboard', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'items',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'products',  jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'customers', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'suppliers', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'sales',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'purchases', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'users',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'roles',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'settings',  jsonb_build_object('view',true,'create',true,'edit',true,'delete',true)
    ) as admin_p,
    -- Manager: full operations, no user/role admin
    jsonb_build_object(
      'dashboard', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'items',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'products',  jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'customers', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'suppliers', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'sales',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'purchases', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'users',     jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'roles',     jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'settings',  jsonb_build_object('view',true,'create',true,'edit',true,'delete',false)
    ) as mgr_p,
    -- Sales: customers + sales full, view inventory, no admin
    jsonb_build_object(
      'dashboard', jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'items',     jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'products',  jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'customers', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'suppliers', jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'sales',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'purchases', jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'users',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'roles',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'settings',  jsonb_build_object('view',false,'create',false,'edit',false,'delete',false)
    ) as sales_p,
    -- Purchasing: suppliers + items + purchases full, view products
    jsonb_build_object(
      'dashboard', jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'items',     jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'products',  jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'customers', jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'suppliers', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'sales',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'purchases', jsonb_build_object('view',true,'create',true,'edit',true,'delete',true),
      'users',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'roles',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'settings',  jsonb_build_object('view',false,'create',false,'edit',false,'delete',false)
    ) as purch_p,
    -- Viewer: read-only on operational modules
    jsonb_build_object(
      'dashboard', jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'items',     jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'products',  jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'customers', jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'suppliers', jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'sales',     jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'purchases', jsonb_build_object('view',true,'create',false,'edit',false,'delete',false),
      'users',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'roles',     jsonb_build_object('view',false,'create',false,'edit',false,'delete',false),
      'settings',  jsonb_build_object('view',false,'create',false,'edit',false,'delete',false)
    ) as viewer_p
)
insert into public.roles (name, description, permissions, is_system)
select 'Administrator', 'Full access to all modules', admin_p, true from perms
union all select 'Manager',      'Manage operations (no user/role admin)', mgr_p,    false from perms
union all select 'Sales',        'Sales staff: customers, sales, view inventory', sales_p, false from perms
union all select 'Purchasing',   'Purchasing staff: suppliers, items, purchases', purch_p, false from perms
union all select 'Viewer',       'Read-only access to operational modules', viewer_p, false from perms
on conflict (name) do update set permissions = excluded.permissions;

-- ---------------------------------------------------------------------
-- Default settings
-- ---------------------------------------------------------------------
insert into public.settings (id, data)
values (1, '{
  "company": {
    "name": "My Company",
    "address": "123 Business Rd",
    "phone": "+1 555-0100",
    "email": "info@company.com",
    "taxId": ""
  },
  "currency": { "symbol": "$", "code": "USD" },
  "tax": { "defaultRate": 10 },
  "numbering": {
    "invoicePrefix":  "INV-",
    "poPrefix":       "PO-",
    "customerPrefix": "CUST-",
    "supplierPrefix": "SUP-",
    "itemPrefix":     "ITM-",
    "productPrefix":  "PRD-",
    "nextInvoice":  1, "nextPO":   1,
    "nextCustomer": 1, "nextSupplier": 1,
    "nextItem":     1, "nextProduct":  1
  },
  "itemCategories":    ["Raw Material","Component","Packaging","Consumable"],
  "productCategories": ["Electronics","Apparel","Food & Beverage","Home Goods","Other"],
  "units":             ["pcs","kg","g","l","ml","m","cm","box","pack","set"],
  "paymentTerms":      ["Cash","Net 7","Net 15","Net 30","Net 60","Net 90"],
  "lowStockThreshold": 10
}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Sample items
-- ---------------------------------------------------------------------
insert into public.items (code, name, category, unit, cost_price, current_stock, min_stock, status) values
  ('ITM-00001','Steel Rod',     'Raw Material','kg',  5.00, 100, 20, 'active'),
  ('ITM-00002','Plastic Pellet','Raw Material','kg',  7.50,  85, 20, 'active'),
  ('ITM-00003','Cardboard Box', 'Packaging',   'pcs', 1.20, 200, 50, 'active'),
  ('ITM-00004','Bubble Wrap',   'Packaging',   'm',   0.80, 150, 50, 'active'),
  ('ITM-00005','Aluminum Sheet','Raw Material','pcs',12.00,  40, 10, 'active')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Sample products
-- ---------------------------------------------------------------------
insert into public.products (code, name, category, sku, unit, cost_price, selling_price, current_stock, min_stock, status) values
  ('PRD-00001','Wireless Mouse',     'Electronics','SKU-1000','pcs', 8.00, 18.00, 50, 10, 'active'),
  ('PRD-00002','Bluetooth Keyboard', 'Electronics','SKU-1001','pcs',12.00, 26.00, 45, 10, 'active'),
  ('PRD-00003','USB-C Cable',        'Electronics','SKU-1002','pcs', 3.50,  9.99, 80, 20, 'active'),
  ('PRD-00004','Notebook A5',        'Other',      'SKU-1003','pcs', 2.00,  6.50,120, 30, 'active'),
  ('PRD-00005','LED Desk Lamp',      'Home Goods', 'SKU-1004','pcs',15.00, 34.00, 25, 10, 'active')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Sample customers
-- ---------------------------------------------------------------------
insert into public.customers (code, name, email, phone, address, city, country, credit_limit, status) values
  ('CUST-00001','Acme Corp',       'acme@example.com',     '+1 555-1001','123 Trade St','New York','USA',5000,'active'),
  ('CUST-00002','Global Traders',  'global@example.com',   '+1 555-1002','45 Market Ave','Chicago','USA',7500,'active'),
  ('CUST-00003','Sunrise Co.',     'sunrise@example.com',  '+1 555-1003','9 Sunrise Way','Miami','USA',3000,'active')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Sample suppliers
-- ---------------------------------------------------------------------
insert into public.suppliers (code, name, email, phone, address, city, country, payment_terms, status) values
  ('SUP-00001','Metal Works Ltd', 'metal@supplier.com',  '+1 555-2001','456 Supply Ave','Chicago','USA','Net 30','active'),
  ('SUP-00002','PolyChem Inc',    'poly@supplier.com',   '+1 555-2002','789 Industrial Rd','Houston','USA','Net 30','active'),
  ('SUP-00003','PackPro Supply',  'pack@supplier.com',   '+1 555-2003','12 Boxworld Pl','Atlanta','USA','Net 15','active')
on conflict (code) do nothing;

-- Bump numbering counters past seeded data
update public.settings set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
  data,
  '{numbering,nextItem}',     '6'::jsonb),
  '{numbering,nextProduct}',  '6'::jsonb),
  '{numbering,nextCustomer}', '4'::jsonb),
  '{numbering,nextSupplier}', '4'::jsonb)
where id = 1;
