-- ============================================================================
-- 00015: Employees + Payroll
--
-- Adds:
--   * employees           — staff master data (incl. commission settings)
--   * salary_payments     — one row per payroll payment (auto-posts journal)
--   * Three expense accounts: 5100 Salaries, 5150 Commission, 5160 Bonus
--   * Numbering counter `nextSalaryPayment` in settings
--   * Grants the `employees` permission to existing Administrator roles
-- ============================================================================

-- ---------------------------------------------------------------------------
-- EMPLOYEES
-- ---------------------------------------------------------------------------
create table if not exists employees (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique not null,
  full_name           text not null,
  email               text,
  phone               text,
  national_id         text,
  department          text,
  position            text,
  hire_date           date not null default current_date,
  termination_date    date,
  base_salary         numeric(14, 2) not null default 0,
  -- Commission settings (per-employee). Rate is a percentage (0-100).
  commission_rate     numeric(6, 3) not null default 0,
  commission_basis    text not null default 'manual'
                       check (commission_basis in ('manual','sales_total','gross_profit')),
  payment_method_id   uuid references payment_methods(id) on delete set null,
  bank_account_no     text,
  status              text not null default 'active'
                       check (status in ('active','inactive','terminated')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_employees_status on employees(status);
create index if not exists idx_employees_name on employees(full_name);

alter table employees enable row level security;

drop policy if exists "employees: read by signed-in" on employees;
create policy "employees: read by signed-in" on employees
  for select using (auth.uid() is not null);

drop policy if exists "employees: write by signed-in" on employees;
create policy "employees: write by signed-in" on employees
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- SALARY PAYMENTS
-- ---------------------------------------------------------------------------
create table if not exists salary_payments (
  id                  uuid primary key default gen_random_uuid(),
  payment_no          text unique not null,
  employee_id         uuid not null references employees(id) on delete restrict,
  period_start        date not null,
  period_end          date not null,
  pay_date            date not null default current_date,
  base_salary         numeric(14, 2) not null default 0,
  commission          numeric(14, 2) not null default 0,
  bonus               numeric(14, 2) not null default 0,
  deductions          numeric(14, 2) not null default 0,
  gross               numeric(14, 2) not null default 0,
  net                 numeric(14, 2) not null default 0,
  payment_method_id   uuid references payment_methods(id) on delete set null,
  journal_entry_id    uuid references journal_entries(id) on delete set null,
  status              text not null default 'posted'
                       check (status in ('draft','posted','cancelled')),
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index if not exists idx_salary_payments_employee on salary_payments(employee_id);
create index if not exists idx_salary_payments_pay_date on salary_payments(pay_date desc);
create index if not exists idx_salary_payments_status on salary_payments(status);

alter table salary_payments enable row level security;

drop policy if exists "salary_payments: read by signed-in" on salary_payments;
create policy "salary_payments: read by signed-in" on salary_payments
  for select using (auth.uid() is not null);

drop policy if exists "salary_payments: write by signed-in" on salary_payments;
create policy "salary_payments: write by signed-in" on salary_payments
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- CHART OF ACCOUNTS: payroll expense accounts
-- ---------------------------------------------------------------------------
insert into accounts (code, name, type, is_active)
values
  ('5100', 'Salaries Expense',   'expense', true),
  ('5150', 'Commission Expense', 'expense', true),
  ('5160', 'Bonus Expense',      'expense', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- SETTINGS: numbering counter for payroll
-- ---------------------------------------------------------------------------
update settings
set data = jsonb_set(
  coalesce(data, '{}'::jsonb),
  '{numbering,nextSalaryPayment}',
  '1'::jsonb,
  true
)
where (data #> '{numbering,nextSalaryPayment}') is null;

-- ---------------------------------------------------------------------------
-- PERMISSIONS: grant `employees` to Administrator role(s)
-- ---------------------------------------------------------------------------
update roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{employees}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';
