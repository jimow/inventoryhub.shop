-- ============================================================================
-- 00030: Transaction fees / charges on payments & receipts
--
-- Bank / M-Pesa / card fees deducted on a payment or receipt are captured to
-- the Bank Charges (5200) expense account with correct double-entry. `fee` on
-- the payment row records the charge for reporting; the amount applied to the
-- invoice (payments.amount) stays net of the fee so A/R & A/P math is unchanged.
--   Receive 1000 with 20 fee:  Dr Cash 980 · Dr Bank Charges 20 · Cr A/R 1000
--   Pay     1000 with 20 fee:  Dr A/P 1000 · Dr Bank Charges 20 · Cr Cash 1020
-- ============================================================================

alter table public.payments add column if not exists fee numeric not null default 0;
