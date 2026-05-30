-- ============================================================================
-- 00021: Shared-tenancy provisioning (tenant-row model)
--
-- * Makes `settings` one row PER TENANT (it was a singleton id=1).
-- * provision_tenant_row(): create a tenant + seed its baseline (roles,
--   settings, chart of accounts, payment methods) by copying the "default"
--   tenant, re-tagged with the new tenant_id. No schema, no API exposure.
-- * create_tenant_admin_row(): link an Administrator profile for the tenant.
-- Idempotent.
-- ============================================================================

-- settings: drop the singleton constraints, key it by tenant instead.
alter table public.settings drop constraint if exists settings_singleton;
alter table public.settings drop constraint if exists settings_pkey;
create unique index if not exists settings_tenant_uniq on public.settings (tenant_id);

-- ----------------------------------------------------------------------------
create or replace function public.provision_tenant_row(
  p_name      text,
  p_slug      text,
  p_overrides jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_new      uuid;
  v_template uuid;
  v_settings jsonb;
  v_num      jsonb;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Tenant name is required'; end if;

  insert into public.tenants (name, slug)
  values (p_name, nullif(trim(p_slug), ''))
  returning id into v_new;

  select id into v_template from public.tenants where slug = 'default' order by created_at limit 1;
  if v_template is null then
    select id into v_template from public.tenants where id <> v_new order by created_at limit 1;
  end if;

  if v_template is not null then
    -- Roles (new ids; permissions carried over)
    insert into public.roles (tenant_id, name, description, permissions, is_system)
      select v_new, name, description, permissions, is_system
      from public.roles where tenant_id = v_template;

    -- Chart of accounts (parent_id left null — this COA is flat)
    insert into public.accounts (tenant_id, code, name, type, is_system, is_active, description)
      select v_new, code, name, type, is_system, is_active, description
      from public.accounts where tenant_id = v_template;

    -- Payment methods (bank links dropped; set up per shop later)
    begin
      insert into public.payment_methods (tenant_id, name, kind, requires_ref, is_active, meta)
        select v_new, name, kind, requires_ref, is_active, coalesce(meta, '{}'::jsonb)
        from public.payment_methods where tenant_id = v_template;
    exception when others then null; end;

    -- Settings: clone template data, override identity, reset counters
    select data into v_settings from public.settings where tenant_id = v_template limit 1;
  end if;

  v_settings := coalesce(v_settings, '{}'::jsonb);
  if p_overrides ? 'company'  then v_settings := jsonb_set(v_settings, '{company}',  p_overrides->'company',  true); end if;
  if p_overrides ? 'currency' then v_settings := jsonb_set(v_settings, '{currency}', p_overrides->'currency', true); end if;
  if p_overrides ? 'tax'      then v_settings := jsonb_set(v_settings, '{tax}',      p_overrides->'tax',      true); end if;
  if v_settings ? 'numbering' then
    select jsonb_object_agg(k, case when k like 'next%' then to_jsonb(1) else val end)
      into v_num from jsonb_each(v_settings->'numbering') as e(k, val);
    if v_num is not null then v_settings := jsonb_set(v_settings, '{numbering}', v_num, true); end if;
  end if;
  insert into public.settings (tenant_id, data) values (v_new, v_settings)
    on conflict (tenant_id) do update set data = excluded.data;

  return v_new;
end
$fn$;

-- ----------------------------------------------------------------------------
create or replace function public.create_tenant_admin_row(
  p_tenant    uuid,
  p_user_id   uuid,
  p_username  text,
  p_full_name text,
  p_email     text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_admin uuid;
begin
  select id into v_admin from public.roles
  where tenant_id = p_tenant and name = 'Administrator' limit 1;

  insert into public.profiles (id, tenant_id, username, full_name, email, role_id, status)
  values (p_user_id, p_tenant, p_username, p_full_name, p_email, v_admin, 'active')
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        role_id   = excluded.role_id,
        username  = excluded.username,
        full_name = excluded.full_name,
        email     = excluded.email,
        status    = 'active';
end
$fn$;

revoke all on function public.provision_tenant_row(text, text, jsonb)        from public, anon, authenticated;
revoke all on function public.create_tenant_admin_row(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_tenant_row(text, text, jsonb)        to service_role;
grant execute on function public.create_tenant_admin_row(uuid, uuid, text, text, text) to service_role;
