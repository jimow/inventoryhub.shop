-- ============================================================================
-- 00040: Subdomain support for servers
--
-- A server's public host is composed from an optional subdomain label + a base
-- domain (e.g. "mombasa" + "inventorypro.shop" → "mombasa.inventorypro.shop").
-- The composed FQDN is still stored in `domain` (used by nginx + certbot), so
-- nothing downstream changes. These two columns just remember the split for a
-- friendly "pick a subdomain under my domain" editor.
-- Idempotent.
-- ============================================================================
alter table public.platform_servers add column if not exists subdomain   text;
alter table public.platform_servers add column if not exists base_domain text;

-- Best-effort backfill: treat any existing full domain as the base.
update public.platform_servers
set base_domain = domain
where base_domain is null and coalesce(domain, '') <> '';
