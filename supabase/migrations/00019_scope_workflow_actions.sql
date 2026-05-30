-- ============================================================================
-- 00019: Scope approve/post to the payroll module only
--
-- Migration 00016 set approve=true / post=true on *every* module the
-- Administrator held, but those actions are only meaningful on `payroll`
-- (run → approve → pay). The app now renders approve/post only for modules
-- that support them, so strip the stray keys from every other module on every
-- role to keep stored permissions honest.
--
-- payroll keeps its approve/post; all other modules lose those two keys.
-- Idempotent.
-- ============================================================================

update roles r
set permissions = (
  select jsonb_object_agg(
    key,
    case when key = 'payroll' then value
         else value - 'approve' - 'post'
    end
  )
  from jsonb_each(r.permissions)
)
where r.permissions is not null
  and r.permissions <> '{}'::jsonb;
