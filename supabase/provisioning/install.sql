-- ============================================================================
-- Multi-tenant provisioning toolkit  (run ONCE per Supabase project)
--
-- Model: schema-per-tenant. Each shop lives in its own Postgres schema with an
-- identical table structure cloned from a template schema (default `public`,
-- which the migrations already build). No database is ever recreated.
--
-- Run this whole file once in the Supabase SQL editor (as the postgres role).
-- Thereafter, provision a shop by calling public.tenant_provision(...) — the
-- scripts/provision-tenant.mjs CLI does this for you over the service-role API.
--
-- Functions are SECURITY DEFINER (owned by the installing superuser) so they
-- can create schemas/tables/policies; only `service_role` may invoke the
-- public entry points.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Tenant registry — the source of truth for "which schemas are shops".
--    Drives tenant_sync_all so upgrades hit every live shop automatically.
--    RLS on + no policies => invisible to anon/authenticated; service_role and
--    the SECURITY DEFINER functions (run as owner) still see it.
-- ----------------------------------------------------------------------------
create table if not exists public.tenants (
  schema_name  text primary key,
  company_name text,
  created_at   timestamptz not null default now()
);
alter table public.tenants enable row level security;

-- ----------------------------------------------------------------------------
-- 1) Clone table STRUCTURE (no data): tables, defaults, PK/unique/check,
--    indexes, then foreign keys and triggers (which LIKE does not copy).
-- ----------------------------------------------------------------------------
create or replace function public.tenant_clone_schema(p_src text, p_dest text)
returns void
language plpgsql
security definer
set search_path = pg_catalog          -- force pg_get_* to fully-qualify names
as $fn$
declare
  r    record;
  vdef text;
begin
  execute format('create schema if not exists %I', p_dest);

  -- Tables (structure only). INCLUDING ALL copies defaults, not-null, PK,
  -- unique, check, indexes, identity, comments — but NOT FKs or triggers.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_src and c.relkind = 'r'
    order by c.relname
  loop
    execute format('create table if not exists %I.%I (like %I.%I including all)',
                   p_dest, r.relname, p_src, r.relname);
    -- Re-apply RLS enable/force state (LIKE drops it).
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = p_src and c.relname = r.relname and c.relrowsecurity
    ) then
      execute format('alter table %I.%I enable row level security', p_dest, r.relname);
    end if;
  end loop;

  -- Foreign keys. Same-schema references (public.*) are rewritten to the
  -- destination; cross-schema references (auth.users) are preserved.
  for r in
    select con.conname, cl.relname as tbl, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = p_src and con.contype = 'f'
  loop
    vdef := replace(r.def, quote_ident(p_src) || '.', quote_ident(p_dest) || '.');
    begin
      execute format('alter table %I.%I add constraint %I %s', p_dest, r.tbl, r.conname, vdef);
    exception when duplicate_object then null;
    end;
  end loop;

  -- Triggers. Re-point only the "ON <schema>.<table>" target; the trigger
  -- function (kept in its original schema, schema-agnostic) is untouched.
  for r in
    select t.tgname, cl.relname as tbl, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class cl on cl.oid = t.tgrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = p_src and not t.tgisinternal
  loop
    vdef := replace(
      r.def,
      ' ON ' || quote_ident(p_src)  || '.' || quote_ident(r.tbl),
      ' ON ' || quote_ident(p_dest) || '.' || quote_ident(r.tbl)
    );
    begin
      execute vdef;
    exception when duplicate_object then null;
    end;
  end loop;
end
$fn$;

-- ----------------------------------------------------------------------------
-- 2) Per-schema has_permission(): reads THIS schema's profiles/roles. RLS
--    policies in the tenant schema call it (see step 3).
-- ----------------------------------------------------------------------------
create or replace function public.tenant_apply_has_permission(p_dest text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
begin
  execute format($q$
    create or replace function %I.has_permission(p_uid uuid, p_module text, p_action text)
    returns boolean
    language sql stable security definer
    set search_path = %I
    as $b$
      select coalesce(
        (select (r.permissions -> p_module ->> p_action)::boolean
           from profiles p
           join roles r on r.id = p.role_id
          where p.id = p_uid and p.status = 'active'),
        false);
    $b$;
  $q$, p_dest, p_dest);

  execute format(
    'grant execute on function %I.has_permission(uuid, text, text) to authenticated, service_role',
    p_dest);
end
$fn$;

-- ----------------------------------------------------------------------------
-- 3) Clone RLS policies. Copies every policy from the template, rewriting
--    public.* references (incl. public.has_permission) to the tenant schema.
--    Auto-adapts to future migrations — no per-table maintenance here.
-- ----------------------------------------------------------------------------
create or replace function public.tenant_clone_policies(p_src text, p_dest text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  r      record;
  vqual  text;
  vcheck text;
  vroles text;
  vcmd   text;
  vsql   text;
begin
  for r in
    select pol.polname, cl.relname as tbl, pol.polcmd, pol.polpermissive,
           pg_get_expr(pol.polqual, pol.polrelid)      as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as withcheck,
           (select string_agg(quote_ident(rolname), ', ')
              from pg_roles where oid = any(pol.polroles)) as roles
    from pg_policy pol
    join pg_class cl on cl.oid = pol.polrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = p_src
  loop
    vcmd := case r.polcmd
              when 'r' then 'select' when 'a' then 'insert'
              when 'w' then 'update' when 'd' then 'delete' else 'all' end;
    vroles := coalesce(r.roles, 'public');
    vqual  := replace(coalesce(r.qual, ''),      quote_ident(p_src) || '.', quote_ident(p_dest) || '.');
    vcheck := replace(coalesce(r.withcheck, ''), quote_ident(p_src) || '.', quote_ident(p_dest) || '.');

    vsql := format('create policy %I on %I.%I as %s for %s to %s',
              r.polname, p_dest, r.tbl,
              case when r.polpermissive then 'permissive' else 'restrictive' end,
              vcmd, vroles);
    if r.qual      is not null then vsql := vsql || format(' using (%s)', vqual);      end if;
    if r.withcheck is not null then vsql := vsql || format(' with check (%s)', vcheck); end if;

    begin execute vsql; exception when duplicate_object then null; end;
  end loop;
end
$fn$;

-- ----------------------------------------------------------------------------
-- 4) Grants so PostgREST (anon/authenticated/service_role) can reach the
--    schema. Row visibility is still governed by RLS.
-- ----------------------------------------------------------------------------
create or replace function public.tenant_grants(p_dest text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
begin
  execute format('grant usage on schema %I to anon, authenticated, service_role', p_dest);
  execute format('grant all on all tables    in schema %I to anon, authenticated, service_role', p_dest);
  execute format('grant all on all sequences in schema %I to anon, authenticated, service_role', p_dest);
  execute format('grant all on all functions in schema %I to anon, authenticated, service_role', p_dest);
  execute format('alter default privileges in schema %I grant all on tables    to anon, authenticated, service_role', p_dest);
  execute format('alter default privileges in schema %I grant all on sequences to anon, authenticated, service_role', p_dest);
end
$fn$;

-- ----------------------------------------------------------------------------
-- 5) Seed roles + settings from the template (so they track the latest
--    migrations), then apply this shop's identity + reset numbering counters.
-- ----------------------------------------------------------------------------
-- Copy SYSTEM reference data (not demo data) the app needs to function:
-- the chart of accounts (journals require it), bank accounts, and payment
-- methods. Idempotent — safe to run on provision AND on sync to backfill.
-- Demo rows (items/products/customers/suppliers) are intentionally NOT copied.
create or replace function public.tenant_seed_reference(p_dest text, p_src text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
begin
  -- Chart of accounts. Two-pass so self-referencing parent_id can't violate the
  -- FK regardless of row order.
  begin
    execute format(
      'insert into %I.accounts (id, code, name, type, parent_id, is_system, is_active, description, created_at, updated_at)
         select id, code, name, type, null, is_system, is_active, description, now(), now()
         from %I.accounts
       on conflict (code) do nothing', p_dest, p_src);
    execute format(
      'update %I.accounts d set parent_id = s.parent_id
         from %I.accounts s where d.id = s.id and s.parent_id is not null and d.parent_id is null',
      p_dest, p_src);
  exception when others then null; end;

  -- Bank accounts (referenced by payment methods) — usually empty in template.
  begin
    execute format('insert into %I.bank_accounts select * from %I.bank_accounts on conflict (id) do nothing',
      p_dest, p_src);
  exception when others then null; end;

  -- Payment methods (Cash, M-Pesa, Bank, Card, …).
  begin
    execute format(
      'insert into %I.payment_methods select * from %I.payment_methods on conflict (id) do nothing',
      p_dest, p_src);
  exception when others then null; end;
end
$fn$;

create or replace function public.tenant_seed(p_dest text, p_src text, p_overrides jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  v_settings jsonb;
  v_num      jsonb;
begin
  -- Default roles: copy the template's seeded roles verbatim.
  execute format(
    'insert into %I.roles (id, name, description, permissions, is_system, created_at, updated_at)
       select id, name, description, permissions, is_system, now(), now() from %I.roles
     on conflict (name) do update set permissions = excluded.permissions',
    p_dest, p_src);

  -- System reference data (chart of accounts, payment methods, bank accounts).
  perform public.tenant_seed_reference(p_dest, p_src);

  -- Settings: clone the template row, override identity fields, reset counters.
  execute format('select data from %I.settings order by id limit 1', p_src) into v_settings;
  if v_settings is null then v_settings := '{}'::jsonb; end if;

  if p_overrides ? 'company'  then v_settings := jsonb_set(v_settings, '{company}',  p_overrides->'company',  true); end if;
  if p_overrides ? 'currency' then v_settings := jsonb_set(v_settings, '{currency}', p_overrides->'currency', true); end if;
  if p_overrides ? 'tax'      then v_settings := jsonb_set(v_settings, '{tax}',      p_overrides->'tax',      true); end if;
  if p_overrides ? 'locale'   then v_settings := jsonb_set(v_settings, '{locale}',   p_overrides->'locale',   true); end if;

  if v_settings ? 'numbering' then
    select jsonb_object_agg(k, case when k like 'next%' then to_jsonb(1) else val end)
      into v_num
      from jsonb_each(v_settings->'numbering') as e(k, val);
    if v_num is not null then v_settings := jsonb_set(v_settings, '{numbering}', v_num, true); end if;
  end if;

  execute format('insert into %I.settings (id, data) values (1, %L)
                  on conflict (id) do update set data = excluded.data', p_dest, v_settings);
end
$fn$;

-- ----------------------------------------------------------------------------
-- 6) Orchestrator — the public entry point the CLI calls.
-- ----------------------------------------------------------------------------
create or replace function public.tenant_provision(
  p_schema    text,
  p_overrides jsonb default '{}'::jsonb,
  p_template  text  default 'public'
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
begin
  if p_schema is null or p_schema !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'Invalid schema name "%". Use lower_snake_case, 2-41 chars.', p_schema;
  end if;
  if p_schema in ('public','auth','storage','graphql','graphql_public','realtime',
                  'extensions','pgbouncer','vault','pg_catalog','information_schema','cron','net') then
    raise exception 'Reserved schema name: %', p_schema;
  end if;
  if exists (select 1 from pg_namespace where nspname = p_schema) then
    raise exception 'Schema "%" already exists — refusing to overwrite.', p_schema;
  end if;
  if not exists (select 1 from pg_namespace where nspname = p_template) then
    raise exception 'Template schema "%" does not exist.', p_template;
  end if;

  perform public.tenant_clone_schema(p_template, p_schema);
  perform public.tenant_apply_has_permission(p_schema);
  perform public.tenant_clone_policies(p_template, p_schema);
  perform public.tenant_grants(p_schema);
  perform public.tenant_seed(p_schema, p_template, coalesce(p_overrides, '{}'::jsonb));

  insert into public.tenants (schema_name, company_name)
  values (p_schema, p_overrides->'company'->>'name')
  on conflict (schema_name) do update set company_name = excluded.company_name;

  return p_schema;
end
$fn$;

-- ----------------------------------------------------------------------------
-- 6b) SYNC an existing tenant up to the template — idempotent. Adds any new
--     tables and columns, refreshes FKs/triggers/policies/grants/has_permission,
--     and inserts any brand-new default roles. Existing role permissions are
--     NEVER overwritten (preserves each shop's customisations).
--     Run after applying a migration to the template.
-- ----------------------------------------------------------------------------
create or replace function public.tenant_sync_schema(p_src text, p_dest text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  r    record;
  p    record;
  vdef text;
begin
  -- New tables
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_src and c.relkind = 'r'
      and not exists (select 1 from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
                      where n2.nspname = p_dest and c2.relname = c.relname)
  loop
    execute format('create table %I.%I (like %I.%I including all)', p_dest, r.relname, p_src, r.relname);
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = p_src and c.relname = r.relname and c.relrowsecurity) then
      execute format('alter table %I.%I enable row level security', p_dest, r.relname);
    end if;
  end loop;

  -- New columns on existing tables
  for r in
    select c.relname as tbl, a.attname as col,
           format_type(a.atttypid, a.atttypmod) as typ,
           a.attnotnull as notnull,
           pg_get_expr(ad.adbin, ad.adrelid) as defexpr
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where n.nspname = p_src and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      and exists (select 1 from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
                  where n2.nspname = p_dest and c2.relname = c.relname)
      and not exists (
        select 1 from pg_attribute a2
        join pg_class c2 on c2.oid = a2.attrelid
        join pg_namespace n2 on n2.oid = c2.relnamespace
        where n2.nspname = p_dest and c2.relname = c.relname
          and a2.attname = a.attname and not a2.attisdropped)
  loop
    vdef := format('alter table %I.%I add column if not exists %I %s', p_dest, r.tbl, r.col, r.typ);
    if r.defexpr is not null then
      vdef := vdef || ' default ' || replace(r.defexpr, quote_ident(p_src) || '.', quote_ident(p_dest) || '.');
    end if;
    -- Only enforce NOT NULL when there's a default (safe against existing rows).
    if r.notnull and r.defexpr is not null then vdef := vdef || ' not null'; end if;
    begin execute vdef; exception when others then null; end;
  end loop;

  -- Missing foreign keys
  for r in
    select con.conname, cl.relname as tbl, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = p_src and con.contype = 'f'
      and not exists (
        select 1 from pg_constraint c2
        join pg_class cl2 on cl2.oid = c2.conrelid
        join pg_namespace n2 on n2.oid = cl2.relnamespace
        where n2.nspname = p_dest and cl2.relname = cl.relname and c2.conname = con.conname)
  loop
    vdef := replace(r.def, quote_ident(p_src) || '.', quote_ident(p_dest) || '.');
    begin execute format('alter table %I.%I add constraint %I %s', p_dest, r.tbl, r.conname, vdef);
    exception when others then null; end;
  end loop;

  -- Missing triggers
  for r in
    select t.tgname, cl.relname as tbl, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class cl on cl.oid = t.tgrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = p_src and not t.tgisinternal
      and not exists (
        select 1 from pg_trigger t2
        join pg_class cl2 on cl2.oid = t2.tgrelid
        join pg_namespace n2 on n2.oid = cl2.relnamespace
        where n2.nspname = p_dest and cl2.relname = cl.relname
          and t2.tgname = t.tgname and not t2.tgisinternal)
  loop
    vdef := replace(r.def,
      ' ON ' || quote_ident(p_src)  || '.' || quote_ident(r.tbl),
      ' ON ' || quote_ident(p_dest) || '.' || quote_ident(r.tbl));
    begin execute vdef; exception when others then null; end;
  end loop;

  -- Refresh has_permission, then drop & re-clone all policies (catches changes).
  perform public.tenant_apply_has_permission(p_dest);
  for p in
    select pol.polname, cl.relname as tbl
    from pg_policy pol
    join pg_class cl on cl.oid = pol.polrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = p_dest
  loop
    execute format('drop policy if exists %I on %I.%I', p.polname, p_dest, p.tbl);
  end loop;
  perform public.tenant_clone_policies(p_src, p_dest);
  perform public.tenant_grants(p_dest);

  -- Add brand-new default roles only — never clobber tenant customisations.
  execute format(
    'insert into %I.roles (id, name, description, permissions, is_system, created_at, updated_at)
       select id, name, description, permissions, is_system, now(), now() from %I.roles
     on conflict (name) do nothing',
    p_dest, p_src);

  -- Backfill any missing system reference data (e.g. chart of accounts that a
  -- shop provisioned before this existed never received).
  perform public.tenant_seed_reference(p_dest, p_src);
end
$fn$;

-- ----------------------------------------------------------------------------
-- 6c) Sync EVERY registered tenant. Returns a per-shop report.
-- ----------------------------------------------------------------------------
create or replace function public.tenant_sync_all(p_src text default 'public')
returns table(schema_name text, status text)
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare r record;
begin
  for r in select t.schema_name from public.tenants t order by t.schema_name loop
    begin
      perform public.tenant_sync_schema(p_src, r.schema_name);
      perform public.tenant_ensure_exposed(r.schema_name);
      schema_name := r.schema_name; status := 'ok'; return next;
    exception when others then
      schema_name := r.schema_name; status := 'ERROR: ' || sqlerrm; return next;
    end;
  end loop;
end
$fn$;

-- ----------------------------------------------------------------------------
-- 7) Link a shop's first admin: an auth.users id -> Administrator profile in
--    the tenant schema. (The CLI creates the auth user via the Admin API.)
-- ----------------------------------------------------------------------------
create or replace function public.tenant_create_admin(
  p_schema    text,
  p_user_id   uuid,
  p_username  text,
  p_full_name text,
  p_email     text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  v_role uuid;
begin
  execute format('select id from %I.roles where name = %L limit 1', p_schema, 'Administrator')
    into v_role;

  execute format(
    'insert into %I.profiles (id, username, full_name, email, role_id, status)
       values (%L, %L, %L, %L, %L, ''active'')
     on conflict (id) do update set role_id = excluded.role_id, status = ''active''',
    p_schema, p_user_id, p_username, p_full_name, p_email, v_role);
end
$fn$;

-- ----------------------------------------------------------------------------
-- 8) Best-effort: add the schema to PostgREST's exposed list and reload.
--    On managed platforms this may be blocked — then add it in the dashboard
--    (Settings > API > Exposed schemas). The CLI surfaces the returned hint.
-- ----------------------------------------------------------------------------
create or replace function public.tenant_ensure_exposed(p_schema text)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  v_current text;
  v_new     text;
begin
  select split_part(cfg, '=', 2)
    into v_current
    from pg_roles r, lateral unnest(coalesce(r.rolconfig, array[]::text[])) as cfg
   where r.rolname = 'authenticator' and cfg like 'pgrst.db_schemas=%'
   limit 1;

  -- Baseline must keep Supabase's own exposed schemas, or GraphQL/etc. break.
  if v_current is null or v_current = '' then v_current := 'public, graphql_public'; end if;

  -- Add our schema if not already present (token-exact check).
  if (', ' || replace(v_current, ' ', '') || ',') not like ('%,' || p_schema || ',%') then
    v_new := v_current || ', ' || p_schema;
    execute format('alter role authenticator set pgrst.db_schemas = %L', v_new);
  else
    v_new := v_current;
  end if;

  -- Reload BOTH: config picks up the new exposed-schema list; schema rebuilds
  -- the table cache so the new schema's tables are actually queryable. Without
  -- 'reload schema' you get: "Could not find the table … in the schema cache".
  perform pg_notify('pgrst', 'reload config');
  perform pg_notify('pgrst', 'reload schema');
  return 'exposed: ' || v_new;
exception when others then
  -- Couldn't change the role (managed platform). Still nudge a cache reload.
  begin perform pg_notify('pgrst', 'reload schema'); exception when others then null; end;
  return 'MANUAL: add "' || p_schema ||
         '" under Settings > API > Exposed schemas (it reloads automatically)';
end
$fn$;

-- ----------------------------------------------------------------------------
-- Lock down: only service_role can call the public entry points; internal
-- helpers are not callable over the API at all.
-- ----------------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'tenant_clone_schema(text, text)',
    'tenant_apply_has_permission(text)',
    'tenant_clone_policies(text, text)',
    'tenant_grants(text)',
    'tenant_seed_reference(text, text)',
    'tenant_seed(text, text, jsonb)',
    'tenant_provision(text, jsonb, text)',
    'tenant_sync_schema(text, text)',
    'tenant_sync_all(text)',
    'tenant_create_admin(text, uuid, text, text, text)',
    'tenant_ensure_exposed(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', s);
  end loop;

  foreach s in array array[
    'tenant_provision(text, jsonb, text)',
    'tenant_sync_all(text)',
    'tenant_create_admin(text, uuid, text, text, text)',
    'tenant_ensure_exposed(text)'
  ] loop
    execute format('grant execute on function public.%s to service_role', s);
  end loop;
end $$;
