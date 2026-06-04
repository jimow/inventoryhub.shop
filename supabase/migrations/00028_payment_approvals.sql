-- ============================================================================
-- 00028: Tiered payment approvals  [Phase 4]
--
-- Money-out payments above configurable thresholds are held for approval and
-- only post their journal once enough approvers (with payments→approve) have
-- signed off. Settings hold the thresholds (tiers); the number of tiers an
-- amount meets = number of approval levels required.
--
-- Approval state lives on the payments row (no new table):
--   approval_status: not_required | pending | approved | rejected
--   required_levels: how many approvals are needed
--   approvals:       jsonb array of {user_id, name, at}
--   pending_lines:   the journal lines to post once approved
--   pending_desc:    the journal description
-- ============================================================================

alter table public.payments add column if not exists approval_status text not null default 'not_required';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_approval_status_chk') then
    alter table public.payments add constraint payments_approval_status_chk
      check (approval_status in ('not_required','pending','approved','rejected'));
  end if;
end $$;
alter table public.payments add column if not exists required_levels int not null default 0;
alter table public.payments add column if not exists approvals jsonb not null default '[]'::jsonb;
alter table public.payments add column if not exists pending_lines jsonb;
alter table public.payments add column if not exists pending_desc text;

-- Default (empty) approval tiers — no approval required until configured.
update public.settings
set data = jsonb_set(coalesce(data, '{}'::jsonb), '{approvals}', '{"tiers": []}'::jsonb, true)
where (data #> '{approvals}') is null;

-- Grant payments→approve to Administrator on every tenant.
update public.roles
set permissions = jsonb_set(coalesce(permissions, '{}'::jsonb), '{payments,approve}', 'true'::jsonb, true)
where name = 'Administrator' and permissions ? 'payments';
