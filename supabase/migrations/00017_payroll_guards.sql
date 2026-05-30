-- ============================================================================
-- 00017: Payroll guards
--
-- Enforces, at the database level, that an employee can only be paid once for
-- a given pay period. Application code (createSalaryPayment) checks this first
-- and returns a friendly error, but the partial unique index closes the race
-- window where two concurrent requests could both pass the check.
--
-- Cancelled payments are excluded so a period can be re-paid after a reversal.
-- ============================================================================

create unique index if not exists uq_salary_payment_employee_period
  on salary_payments (employee_id, period_start, period_end)
  where status <> 'cancelled';
