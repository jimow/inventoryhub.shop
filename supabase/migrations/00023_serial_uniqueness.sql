-- ============================================================================
-- 00023: Shop-wide serial number uniqueness
--
-- Serials were unique per (product_id, serial_no). Make them unique per shop
-- (tenant_id, serial_no) so the same serial can't exist twice in a shop — even
-- across different products — and a sold serial can never be re-added.
--
-- If this fails because duplicate serials already exist in a tenant, resolve
-- those rows first (rename/scrap one), then re-run.
-- ============================================================================

create unique index if not exists uq_inventory_unit_serial_per_tenant
  on public.inventory_units (tenant_id, serial_no)
  where serial_no is not null and serial_no <> '';
