-- 00007_mpesa_methods.sql
-- Distinguish PayBill from Till in payment methods, and seed both
-- Lipa-Na-M-Pesa flavours so the POS can route STK push correctly.

alter table public.payment_methods
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- Drop the OLD generic "M-Pesa" seed (kind=mpesa, name='M-Pesa') if it has
-- never been used — keeps the list tidy after this migration. (Idempotent.)
update public.payment_methods
   set is_active = false
 where kind = 'mpesa'
   and lower(name) = 'm-pesa'
   and not exists (select 1 from public.payments p where p.payment_method_id = public.payment_methods.id);

-- Sandbox defaults: PayBill 174379 / Till 174379. Override per-tenant by
-- editing the rows in /payment-methods.
insert into public.payment_methods (name, kind, requires_ref, is_active, meta)
values
  ('M-Pesa PayBill', 'mpesa', false, true,
   '{"transaction_type":"CustomerPayBillOnline","shortcode":"174379","label":"Lipa Na M-Pesa Online · PayBill"}'::jsonb),
  ('M-Pesa Till',    'mpesa', false, true,
   '{"transaction_type":"CustomerBuyGoodsOnline","shortcode":"174379","label":"Lipa Na M-Pesa Online · Buy Goods (Till)"}'::jsonb)
on conflict do nothing;

-- Track which M-Pesa method initiated each STK push so the callback can
-- create the Payment under the same method (Till vs PayBill).
alter table public.mpesa_stk
  add column if not exists payment_method_id uuid references public.payment_methods(id);

create index if not exists mpesa_stk_method_idx on public.mpesa_stk (payment_method_id);

-- RLS policies in 00005 select with public.has_permission(... 'accounting','view'),
-- which still applies — meta is just another column on the same row.
