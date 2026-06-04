-- ============================================================================
-- 00029: Opening balances for customers & suppliers
--
-- Lets you record what a customer already owes you (opening AR) or what you
-- already owe a supplier (opening AP) when you first enter them — with a proper
-- double-entry journal so the books are correct from day one. The offsetting
-- side goes to a new "Opening Balance Equity" account (3200).
-- ============================================================================

alter table public.customers add column if not exists opening_balance numeric not null default 0;
alter table public.customers add column if not exists opening_date date;
alter table public.suppliers add column if not exists opening_balance numeric not null default 0;
alter table public.suppliers add column if not exists opening_date date;

-- New chart-of-accounts code 3200 (also added to STANDARD_ACCOUNTS in code, so
-- fresh tenants get it automatically; this backfills existing tenants).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'tenants') then
    insert into public.accounts (tenant_id, code, name, type, is_system, is_active)
    select t.id, '3200', 'Opening Balance Equity', 'equity', true, true
    from public.tenants t
    where not exists (
      select 1 from public.accounts a where a.tenant_id = t.id and a.code = '3200'
    );
  end if;
end $$;
