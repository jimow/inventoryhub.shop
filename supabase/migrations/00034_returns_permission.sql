-- ============================================================================
-- 00034: Give Returns its own permission module
--
-- Returns previously rode on the `sales` / `purchases` permissions. This makes
-- `returns` a first-class module so it appears in Roles & Permissions and gates
-- the Returns page + the return actions independently. Idempotent — safe to run
-- even if 00033 already created the tables.
-- ============================================================================

-- 1) Grant the `returns` module to Administrator on every tenant.
update public.roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{returns}',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  true
)
where name = 'Administrator';

-- 2) Re-point the returns tables' access policy to the `returns` module.
do $$
declare tbl text;
begin
  foreach tbl in array array['sales_returns','purchase_returns'] loop
    if exists (select 1 from information_schema.tables
               where table_schema='public' and table_name = tbl) then
      execute format('drop policy if exists %I on public.%I', tbl || '_rw', tbl);
      execute format($f$
        create policy %I on public.%I for all to authenticated
        using (public.has_permission(auth.uid(), 'returns', 'view'))
        with check (public.has_permission(auth.uid(), 'returns', 'create'))
      $f$, tbl || '_rw', tbl);
    end if;
  end loop;
end $$;
