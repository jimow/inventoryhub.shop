-- ============================================================================
-- 00018: Payroll permission grants
--
-- The app now gates payroll on a dedicated `payroll` module with three
-- workflow actions:
--   * create  — "run payroll" (prepare a batch run + draft lines)
--   * approve — sign off a draft run
--   * post    — "pay" (disburse: post the journals)
--   * edit    — cancel a run / reverse a payment
--   * view    — see the payroll screen
--
-- Grant the full set to Administrator so the screen isn't locked out. Other
-- roles get these assigned manually in the Roles screen. Idempotent — safe to
-- re-run.
-- ============================================================================

update roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{payroll}',
  '{"view": true, "create": true, "edit": true, "delete": true, "approve": true, "post": true}'::jsonb,
  true
)
where name = 'Administrator';
