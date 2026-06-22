-- ============================================================================
-- 00043: Richer store<->shop transfers (serials + charges + double-entry)
--
-- A transfer becomes a proper document: numbered, with an optional reference,
-- a transport/handling CHARGE that posts a journal, the funding account the
-- charge was paid from, and — for serial-tracked products — the exact serial
-- units that moved (captured as jsonb for the document).
--
-- A new "Freight & Handling" expense account (5300) receives charges when the
-- shop is configured (Settings) to expense charges separately rather than
-- capitalize them into inventory cost.
-- ============================================================================

alter table public.stock_transfers
  add column if not exists transfer_no       text,
  add column if not exists reference         text,
  add column if not exists charge            numeric(14,2) not null default 0,
  add column if not exists charge_paid_from  uuid references public.payment_methods(id) on delete set null,
  add column if not exists serials           jsonb not null default '[]'::jsonb,
  add column if not exists journal_entry_id  uuid references public.journal_entries(id) on delete set null;

-- numbering counter for transfer documents -----------------------------------
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{numbering,nextTransfer}', '1'::jsonb, true)
where (data #> '{numbering,nextTransfer}') is null;

-- Freight & Handling expense account (5300) for existing tenants -------------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'tenants') then
    insert into public.accounts (tenant_id, code, name, type, is_system, is_active)
    select t.id, '5300', 'Freight & Handling', 'expense', true, true
    from public.tenants t
    where not exists (
      select 1 from public.accounts a where a.tenant_id = t.id and a.code = '5300'
    );
  else
    insert into public.accounts (code, name, type, is_system, is_active)
    select '5300', 'Freight & Handling', 'expense', true, true
    where not exists (select 1 from public.accounts a where a.code = '5300');
  end if;
end $$;
