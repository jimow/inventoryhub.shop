-- 00008_mpesa_split.sql
-- Distinguish two ways merchants accept M-Pesa:
--
--   1. M-Pesa (manual)            – customer sends to a personal number;
--                                   cashier types the M-Pesa code as reference.
--                                   No STK push, no Daraja call.
--
--   2. Lipa Na M-Pesa Online STK  – we push an STK prompt via Daraja.
--                                   Two flavours:
--                                     · PayBill  (CustomerPayBillOnline)
--                                     · Till     (CustomerBuyGoodsOnline)
--
-- The POS UI routes on the presence of meta.transaction_type:
--   has it  -> STK push flow
--   missing -> manual reference flow (just like recording a bank transfer)

-- Make sure both default STK methods exist with shortcode 174379 (sandbox).
-- They were inserted by 00007 already; only insert if missing.
insert into public.payment_methods (name, kind, requires_ref, is_active, meta)
select 'M-Pesa PayBill (Lipa Na M-Pesa)', 'mpesa', false, true,
       '{"transaction_type":"CustomerPayBillOnline","shortcode":"174379","label":"Lipa Na M-Pesa Online · PayBill"}'::jsonb
where not exists (
  select 1 from public.payment_methods
  where kind = 'mpesa' and meta->>'transaction_type' = 'CustomerPayBillOnline'
);

insert into public.payment_methods (name, kind, requires_ref, is_active, meta)
select 'M-Pesa Till (Lipa Na M-Pesa Buy Goods)', 'mpesa', false, true,
       '{"transaction_type":"CustomerBuyGoodsOnline","shortcode":"174379","label":"Lipa Na M-Pesa Online · Buy Goods (Till)"}'::jsonb
where not exists (
  select 1 from public.payment_methods
  where kind = 'mpesa' and meta->>'transaction_type' = 'CustomerBuyGoodsOnline'
);

-- Generic "M-Pesa (manual)" — no STK, just record a code. Useful for sole
-- traders who get M-Pesa to a phone and reconcile by hand.
insert into public.payment_methods (name, kind, requires_ref, is_active, meta)
select 'M-Pesa (manual)', 'mpesa', true, true,
       '{"label":"M-Pesa · manual reference"}'::jsonb
where not exists (
  select 1 from public.payment_methods
  where kind = 'mpesa' and (meta is null or not (meta ? 'transaction_type'))
);

-- Re-promote the old generic 'M-Pesa' seed (if it was deactivated by 00007 because
-- it had been unused) so users still see it.
update public.payment_methods
   set is_active = true
 where kind = 'mpesa'
   and lower(name) = 'm-pesa'
   and (meta is null or not (meta ? 'transaction_type'));
