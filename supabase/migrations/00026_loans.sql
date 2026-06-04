-- ============================================================================
-- 00026: Loans — borrowing (payable) and lending (receivable)  [Phase 2]
--
-- * loans          — a borrowed or lent principal + terms
-- * loan_payments  — repayments/receipts, split into principal + interest
--
-- Journals (accounts auto-created by ensureChartOfAccounts):
--   Borrow:  Dr Cash/Bank            Cr Loans Payable (2300)
--   Lend:    Dr Loans Receivable (1400)  Cr Cash/Bank
--   Repay borrowing:  Dr Loans Payable + Dr Interest Expense (5900)  Cr Cash
--   Receive on lending: Dr Cash  Cr Loans Receivable + Cr Interest Income (4200)
--
-- New permission module `loans`. Tenant-isolated. Idempotent.
-- ============================================================================

create table if not exists public.loans (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  loan_no           text,
  direction         text not null check (direction in ('payable','receivable')),
  party_name        text not null,
  principal         numeric(14,2) not null,
  interest_rate     numeric(7,3) not null default 0,   -- annual %
  start_date        date not null default current_date,
  due_date          date,
  status            text not null default 'active' check (status in ('active','settled','cancelled')),
  payment_method_id uuid references public.payment_methods(id),
  journal_entry_id  uuid references public.journal_entries(id),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create table if not exists public.loan_payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid default public.current_tenant_id(),
  payment_no        text,
  loan_id           uuid not null references public.loans(id) on delete cascade,
  date              date not null default current_date,
  amount            numeric(14,2) not null,
  principal_portion numeric(14,2) not null default 0,
  interest_portion  numeric(14,2) not null default 0,
  payment_method_id uuid references public.payment_methods(id),
  journal_entry_id  uuid references public.journal_entries(id),
  status            text not null default 'posted' check (status in ('posted','cancelled')),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists loans_tenant_idx on public.loans (tenant_id);
create index if not exists loan_payments_tenant_idx on public.loan_payments (tenant_id);
create index if not exists loan_payments_loan_idx on public.loan_payments (loan_id);

do $$
declare t text;
begin
  foreach t in array array['loans','loan_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_isolation', t);
    execute format($f$
      create policy %I on public.%I as restrictive to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())
    $f$, t || '_tenant_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (public.has_permission(auth.uid(), 'loans', 'view'))
      with check (public.has_permission(auth.uid(), 'loans', 'create'))
    $f$, t || '_rw', t);
  end loop;
end $$;

update public.settings
set data = jsonb_set(
  jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextLoan}', '1'::jsonb, true),
  '{numbering,nextLoanPayment}', '1'::jsonb, true)
where (data #> '{numbering,nextLoan}') is null;

update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{loans}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';
