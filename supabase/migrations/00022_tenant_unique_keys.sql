-- ============================================================================
-- 00022: Make unique business keys tenant-scoped
--
-- Under shared tenancy, a UNIQUE(code) constraint would stop two shops from
-- both having e.g. account "1300" or role "Administrator". Convert every unique
-- constraint on a public table to UNIQUE(tenant_id, <cols>), and fix the
-- partial unique index used for the payroll duplicate guard.
-- Idempotent.
-- ============================================================================

do $$
declare
  r      record;
  v_cols text;
begin
  for r in
    select c.conname, cl.relname as tbl, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and c.contype = 'u' and cl.relname <> 'tenants'
  loop
    if r.def ~ 'tenant_id' then continue; end if;     -- already scoped
    v_cols := substring(r.def from '\((.*)\)');         -- columns inside parens
    if v_cols is null or v_cols = '' then continue; end if;
    begin
      execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
      execute format('alter table public.%I add constraint %I unique (tenant_id, %s)', r.tbl, r.conname, v_cols);
    exception when others then
      raise notice 'Skipped unique constraint %.% : %', r.tbl, r.conname, sqlerrm;
    end;
  end loop;
end $$;

-- Payroll duplicate guard (a partial unique INDEX, not a constraint).
drop index if exists public.uq_salary_payment_employee_period;
create unique index if not exists uq_salary_payment_employee_period
  on public.salary_payments (tenant_id, employee_id, period_start, period_end)
  where status <> 'cancelled';
