-- 00010_drop_items.sql
-- Items have been merged into Products. This migration:
--   1. Drops references the items table that block dropping it
--   2. Drops the items table itself
--   3. Cleans up settings.data so the dropped columns don't linger

-- 1) inventory_units (added in 00009) had a CHECK constraint requiring exactly
--    one of product_id/item_id; that constraint also referenced the items
--    table. Drop the constraint, drop the column, replace the constraint with
--    a simple NOT NULL on product_id.
alter table public.inventory_units
  drop constraint if exists inventory_units_one_target;
alter table public.inventory_units
  drop column if exists item_id;
alter table public.inventory_units
  alter column product_id set not null;
drop index if exists public.inventory_units_item_serial_idx;

-- 2) Drop the items table. CASCADE removes any RLS policies still attached.
drop table if exists public.items cascade;

-- 3) Settings cleanup: remove keys that referenced items.
update public.settings
   set data = data
              - 'itemCategories'
              #- '{numbering,itemPrefix}'
              #- '{numbering,nextItem}'
 where id = 1;

-- 4) Roles: drop "items" out of every role's permissions matrix.
update public.roles
   set permissions = permissions - 'items'
 where permissions ? 'items';
