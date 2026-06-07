-- ============================================================================
-- 00039: Explicit funds account per payment method
--
-- Every payment method becomes a real, named "money account" tied to ONE
-- chart-of-accounts asset (a till, a bank, an M-Pesa wallet). This removes the
-- cash-drawer / cash-on-hand / bank confusion (you pick a named account, not a
-- raw code) and makes every money movement land in an explicit, visible place
-- — including borrowed loan funds.
--
-- account_id is the source of truth going forward; the old kind→fixed-code
-- mapping remains only as a fallback for any method left unlinked.
-- Idempotent.
-- ============================================================================
alter table public.payment_methods add column if not exists account_id uuid references public.accounts(id) on delete set null;

-- Backfill: link each method to the GL account its kind currently resolves to.
-- 1) bank methods that point at a bank_account → that bank account's GL account
update public.payment_methods pm
set account_id = ba.account_id
from public.bank_accounts ba
where pm.account_id is null
  and pm.kind = 'bank'
  and pm.bank_account_id = ba.id
  and ba.account_id is not null;

-- 2) everything else → the code its kind mapped to (cash 1010, mpesa 1110, bank/card 1100)
update public.payment_methods pm
set account_id = a.id
from public.accounts a
where pm.account_id is null
  and a.tenant_id = pm.tenant_id
  and a.code = case pm.kind
      when 'cash'  then '1010'
      when 'mpesa' then '1110'
      when 'card'  then '1100'
      when 'bank'  then '1100'
      else '1010'
    end;
