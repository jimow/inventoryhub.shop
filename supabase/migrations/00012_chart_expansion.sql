-- 00012_chart_expansion.sql
-- Round out the chart of accounts so receipts/payments can cover the full
-- range of cash flows a real business sees, not just sales / purchases.
--
-- Adds:
--   2200  Customer Advances        (liability)  — deposits before goods supplied
--   3100  Owner Drawings           (contra-equity)
--   4100  Other Income             (income)
--   4200  Interest Income          (income)
--   5100  Salaries & Wages         (expense)
--   5200  Rent                     (expense)
--   5300  Utilities                (expense)
--   5400  Office Supplies          (expense)
--   5500  Other Operating Expense  (expense)
--   5600  Tax Remitted             (expense / reduces tax payable when paid)

insert into public.accounts (code, name, type, is_system, is_active, description)
values
  ('2200', 'Customer Advances',       'liability', true,  true, 'Money received from customers before goods/services are supplied.'),
  ('3100', 'Owner Drawings',          'equity',    true,  true, 'Owner''s personal withdrawals (contra-equity).'),
  ('4100', 'Other Income',            'income',    true,  true, 'Non-sales income (commissions, refunds in, etc.).'),
  ('4200', 'Interest Income',         'income',    true,  true, 'Interest earned on bank balances or loans given.'),
  ('5100', 'Salaries & Wages',        'expense',   true,  true, 'Payroll costs.'),
  ('5200', 'Rent',                    'expense',   true,  true, 'Premises rent.'),
  ('5300', 'Utilities',               'expense',   true,  true, 'Electricity, water, internet, etc.'),
  ('5400', 'Office Supplies',         'expense',   true,  true, 'Consumables, stationery.'),
  ('5500', 'Other Operating Expense', 'expense',   true,  true, 'Misc. operating costs.'),
  ('5600', 'Tax Remitted',            'expense',   true,  true, 'Payments made to tax authority (reduces Tax Payable).')
on conflict (code) do nothing;

-- Source-type enum is currently 'sale'|'purchase'|'other'. We keep 'other' for
-- all non-sale/non-purchase money movements and tag the sub-type in notes
-- (e.g. "Expense · Rent" or "Customer deposit · ACME") — keeps the schema
-- stable while still letting reports filter by subtype prefix.
