-- =====================================================================
-- 00005_pos_accounting.sql
-- POS, Payments, Bank Accounts, Chart of Accounts, Journal Entries,
-- serial numbers and barcodes for items.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Items: add serial_no + barcode (products already has barcode/sku;
-- add serial_no there too for completeness).
-- ---------------------------------------------------------------------
alter table public.items
  add column if not exists serial_no text,
  add column if not exists barcode   text;
create index if not exists items_barcode_idx   on public.items   (barcode);
create index if not exists items_serial_no_idx on public.items   (serial_no);

alter table public.products
  add column if not exists serial_no text;
create index if not exists products_serial_no_idx on public.products (serial_no);
create index if not exists products_barcode_idx2  on public.products (barcode);

-- ---------------------------------------------------------------------
-- Chart of accounts
--   type: asset | liability | equity | income | expense
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  type        text not null check (type in ('asset','liability','equity','income','expense')),
  parent_id   uuid references public.accounts(id) on delete set null,
  is_system   boolean default false,
  is_active   boolean default true,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists accounts_type_idx on public.accounts (type);

-- ---------------------------------------------------------------------
-- Bank accounts (cash drawers, bank, M-Pesa till, etc.). Each bank
-- account is linked to a chart-of-accounts row so ledger posts hit
-- the right asset.
-- ---------------------------------------------------------------------
create table if not exists public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  bank_name       text,
  account_no      text,
  currency        text default 'USD',
  opening_balance numeric(14,2) default 0,
  account_id      uuid references public.accounts(id) on delete set null,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Payment methods (Cash, M-Pesa, Bank Transfer, Card, ...)
--   kind: cash | mpesa | bank | card | other
-- A payment method may be linked to a bank_account so its received
-- funds land in the correct asset.
-- ---------------------------------------------------------------------
create table if not exists public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            text not null check (kind in ('cash','mpesa','bank','card','other')),
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  requires_ref    boolean default false,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists payment_methods_kind_idx on public.payment_methods (kind);

-- ---------------------------------------------------------------------
-- Payments: any cash IN (sale receipt) or cash OUT (supplier payment).
--   direction: in | out
--   source_type: sale | purchase | other
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  payment_no        text unique not null,
  date              date default current_date,
  direction         text not null check (direction in ('in','out')),
  source_type       text not null default 'sale' check (source_type in ('sale','purchase','other')),
  sale_id           uuid references public.sales(id)     on delete set null,
  purchase_id       uuid references public.purchases(id) on delete set null,
  customer_id       uuid references public.customers(id) on delete set null,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  amount            numeric(14,2) not null,
  reference         text,
  notes             text,
  created_at        timestamptz default now(),
  created_by        uuid references auth.users(id) on delete set null
);
create index if not exists payments_date_idx        on public.payments (date desc);
create index if not exists payments_direction_idx   on public.payments (direction);
create index if not exists payments_sale_idx        on public.payments (sale_id);
create index if not exists payments_purchase_idx    on public.payments (purchase_id);
create index if not exists payments_customer_idx    on public.payments (customer_id);
create index if not exists payments_supplier_idx    on public.payments (supplier_id);

-- ---------------------------------------------------------------------
-- Journal entries (header + lines). All sales, purchases, payments
-- post journal entries automatically; manual entries are also allowed.
-- ---------------------------------------------------------------------
create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  entry_no    text unique not null,
  date        date default current_date,
  description text,
  source_type text default 'manual' check (source_type in ('manual','sale','purchase','payment')),
  source_id   uuid,
  created_at  timestamptz default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create index if not exists journal_entries_date_idx        on public.journal_entries (date desc);
create index if not exists journal_entries_source_type_idx on public.journal_entries (source_type);

create table if not exists public.journal_lines (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.journal_entries(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete restrict,
  debit       numeric(14,2) default 0,
  credit      numeric(14,2) default 0,
  description text
);
create index if not exists journal_lines_entry_idx   on public.journal_lines (entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines (account_id);

-- ---------------------------------------------------------------------
-- updated_at triggers on new tables
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'accounts','bank_accounts','payment_methods'
  ]) loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Sequence helpers reuse settings.numbering
-- Add nextPayment + nextJournal counters
-- ---------------------------------------------------------------------
update public.settings set data = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
  data,
  '{numbering,paymentPrefix}',  '"PMT-"'::jsonb,    true),
  '{numbering,nextPayment}',    '1'::jsonb,         true),
  '{numbering,journalPrefix}',  '"JE-"'::jsonb,     true),
  '{numbering,nextJournal}',    '1'::jsonb,         true)
where id = 1;

-- ---------------------------------------------------------------------
-- RLS for new tables
-- ---------------------------------------------------------------------
alter table public.accounts         enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.payment_methods  enable row level security;
alter table public.payments         enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.journal_lines    enable row level security;

do $$
declare
  t   text;
  mod text;
begin
  for t, mod in
    select * from (values
      ('accounts','accounting'),
      ('bank_accounts','accounting'),
      ('payment_methods','accounting'),
      ('payments','payments'),
      ('journal_entries','accounting'),
      ('journal_lines','accounting')
    ) as v(t, mod)
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($f$
      create policy %I on public.%I for select to authenticated
      using (public.has_permission(auth.uid(), %L, 'view'))
    $f$, t || '_select', t, mod);

    execute format($f$
      create policy %I on public.%I for insert to authenticated
      with check (public.has_permission(auth.uid(), %L, 'create'))
    $f$, t || '_insert', t, mod);

    execute format($f$
      create policy %I on public.%I for update to authenticated
      using      (public.has_permission(auth.uid(), %L, 'edit'))
      with check (public.has_permission(auth.uid(), %L, 'edit'))
    $f$, t || '_update', t, mod, mod);

    execute format($f$
      create policy %I on public.%I for delete to authenticated
      using (public.has_permission(auth.uid(), %L, 'delete'))
    $f$, t || '_delete', t, mod);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Default chart of accounts
-- ---------------------------------------------------------------------
insert into public.accounts (code, name, type, is_system) values
  -- Assets
  ('1000','Cash on Hand',          'asset',     true),
  ('1010','Cash Drawer',           'asset',     true),
  ('1100','Bank',                  'asset',     true),
  ('1110','M-Pesa Wallet',         'asset',     true),
  ('1200','Accounts Receivable',   'asset',     true),
  ('1300','Inventory',             'asset',     true),
  -- Liabilities
  ('2000','Accounts Payable',      'liability', true),
  ('2100','Tax Payable',           'liability', true),
  -- Equity
  ('3000','Owner Equity',          'equity',    true),
  ('3100','Retained Earnings',     'equity',    true),
  -- Income
  ('4000','Sales Revenue',         'income',    true),
  ('4100','Other Income',          'income',    true),
  -- Expenses
  ('5000','Cost of Goods Sold',    'expense',   true),
  ('5100','Operating Expenses',    'expense',   true),
  ('5200','Bank Charges',          'expense',   true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Default payment methods
-- ---------------------------------------------------------------------
insert into public.payment_methods (name, kind, requires_ref, is_active) values
  ('Cash',          'cash',  false, true),
  ('M-Pesa',        'mpesa', true,  true),
  ('Bank Transfer', 'bank',  true,  true),
  ('Card',          'card',  false, true)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Update existing role permissions to include new modules
-- ('payments','accounting','pos')
-- Administrator gets full; Manager full; Sales: pos+payments view+create;
-- Purchasing: payments view+create; Viewer: view all.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  full_perm  jsonb := jsonb_build_object('view',true,'create',true,'edit',true,'delete',true);
  view_only  jsonb := jsonb_build_object('view',true,'create',false,'edit',false,'delete',false);
  none_perm  jsonb := jsonb_build_object('view',false,'create',false,'edit',false,'delete',false);
  cr_perm    jsonb := jsonb_build_object('view',true,'create',true,'edit',false,'delete',false);
begin
  for r in select id, name, permissions from public.roles loop
    if r.name = 'Administrator' then
      update public.roles set permissions = r.permissions
        || jsonb_build_object('payments', full_perm, 'accounting', full_perm, 'pos', full_perm)
        where id = r.id;
    elsif r.name = 'Manager' then
      update public.roles set permissions = r.permissions
        || jsonb_build_object('payments', full_perm, 'accounting', view_only, 'pos', full_perm)
        where id = r.id;
    elsif r.name = 'Sales' then
      update public.roles set permissions = r.permissions
        || jsonb_build_object('payments', cr_perm, 'accounting', none_perm, 'pos', full_perm)
        where id = r.id;
    elsif r.name = 'Purchasing' then
      update public.roles set permissions = r.permissions
        || jsonb_build_object('payments', cr_perm, 'accounting', none_perm, 'pos', none_perm)
        where id = r.id;
    elsif r.name = 'Viewer' then
      update public.roles set permissions = r.permissions
        || jsonb_build_object('payments', view_only, 'accounting', view_only, 'pos', none_perm)
        where id = r.id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
