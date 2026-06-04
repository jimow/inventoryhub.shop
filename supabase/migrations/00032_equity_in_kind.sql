-- ============================================================================
-- 00032: In-kind / opening-capital shareholder contributions
--
-- A contribution can now be settled in cash/bank (Dr asset / Cr Owner Equity)
-- or "in-kind / opening" — claiming a share of equity already on the books from
-- opening stock and opening customer/supplier balances (Dr Opening Balance
-- Equity 3200 / Cr Owner Equity 3000). Either way it counts toward the owner's
-- capital and therefore their shares (under the "by contribution" mode).
-- ============================================================================

alter table public.equity_contributions
  add column if not exists source text not null default 'cash';
