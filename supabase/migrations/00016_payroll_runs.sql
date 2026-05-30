-- ============================================================================
-- 00016: Payroll runs (batch payroll) + finer-grained permissions
--
-- Adds:
--   * payroll_runs               — a payroll batch for a pay period
--   * salary_payments.run_id     — back-reference so individual lines roll up
--   * settings.numbering.nextPayrollRun
--   * Grants the new `payroll` module + `approve`/`post` actions to Admins
--
-- Workflow:
--   1. Prepare a run for [period_start, period_end]; one draft salary_payment
--      per active employee gets inserted, all linked via run_id.
--   2. Edit any line (commission, bonus, deductions).
--   3. Approve the run (manager check).
--   4. Post the run — each line's journal posts atomically; run becomes
--      `posted`. From here individual line cancellation reverses one journal.
--   5. Cancel — if posted, reverse every journal; otherwise just delete drafts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PAYROLL RUNS
-- ---------------------------------------------------------------------------
create table if not exists payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  run_no          text unique not null,
  period_start    date not null,
  period_end      date not null,
  pay_date        date not null default current_date,
  status          text not null default 'draft'
                   check (status in ('draft','approved','posted','cancelled')),
  total_gross     numeric(14, 2) not null default 0,
  total_deductions numeric(14, 2) not null default 0,
  total_net       numeric(14, 2) not null default 0,
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  posted_by       uuid references auth.users(id),
  posted_at       timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index if not exists idx_payroll_runs_status on payroll_runs(status);
create index if not exists idx_payroll_runs_pay_date on payroll_runs(pay_date desc);

alter table payroll_runs enable row level security;

drop policy if exists "payroll_runs: read by signed-in" on payroll_runs;
create policy "payroll_runs: read by signed-in" on payroll_runs
  for select using (auth.uid() is not null);

drop policy if exists "payroll_runs: write by signed-in" on payroll_runs;
create policy "payroll_runs: write by signed-in" on payroll_runs
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- LINK salary_payments → payroll_runs
-- ---------------------------------------------------------------------------
alter table salary_payments
  add column if not exists run_id uuid references payroll_runs(id) on delete cascade;

create index if not exists idx_salary_payments_run on salary_payments(run_id);

-- ---------------------------------------------------------------------------
-- SETTINGS counter for payroll runs (PR-00001)
-- ---------------------------------------------------------------------------
update settings
set data = jsonb_set(
  coalesce(data, '{}'::jsonb),
  '{numbering,nextPayrollRun}',
  '1'::jsonb,
  true
)
where (data #> '{numbering,nextPayrollRun}') is null;

-- ---------------------------------------------------------------------------
-- PERMISSIONS — grant new `payroll` module + approve/post actions to admins
--
-- Existing roles will keep their `employees` permission for staff master data.
-- The new `payroll` module separately controls preparing, approving, and
-- posting payroll runs — so an HR officer can manage staff without being able
-- to actually disburse money, and a finance officer can post runs without
-- editing staff records.
-- ---------------------------------------------------------------------------
update roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{payroll}',
  '{"view": true, "create": true, "edit": true, "delete": true, "approve": true, "post": true}'::jsonb,
  true
)
where name = 'Administrator';

-- Also ensure the new actions exist on every administrator-held module so the
-- /roles UI shows them as enabled. This is additive — sets approve+post=true
-- on every module the admin already has any permission on.
do $$
declare
  rec record;
  mod_key text;
  perms jsonb;
  modperm jsonb;
begin
  for rec in select id, permissions from roles where name = 'Administrator' loop
    perms := coalesce(rec.permissions, '{}'::jsonb);
    for mod_key in select jsonb_object_keys(perms) loop
      modperm := perms -> mod_key;
      -- only set approve/post if at least one action is currently true
      if modperm @> '{"view": true}'::jsonb or modperm @> '{"create": true}'::jsonb
         or modperm @> '{"edit": true}'::jsonb or modperm @> '{"delete": true}'::jsonb then
        modperm := jsonb_set(modperm, '{approve}', 'true'::jsonb, true);
        modperm := jsonb_set(modperm, '{post}',    'true'::jsonb, true);
        perms := jsonb_set(perms, ARRAY[mod_key], modperm, true);
      end if;
    end loop;
    update roles set permissions = perms where id = rec.id;
  end loop;
end$$;
