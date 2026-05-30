-- ============================================================================
-- 00024: "Balances" permission on Customers & Suppliers
--
-- Adds the customers.balances / suppliers.balances permission to roles that
-- should see contact balances by default (Administrator, Manager). Other roles
-- can be granted it in the Roles screen. Applies to every tenant's roles.
-- Idempotent.
-- ============================================================================

update public.roles
set permissions = jsonb_set(
  jsonb_set(
    coalesce(permissions, '{}'::jsonb),
    '{customers,balances}', 'true'::jsonb, true
  ),
  '{suppliers,balances}', 'true'::jsonb, true
)
where name in ('Administrator', 'Manager')
  -- only where the customers/suppliers objects already exist (avoid nulls)
  and permissions ? 'customers'
  and permissions ? 'suppliers';
