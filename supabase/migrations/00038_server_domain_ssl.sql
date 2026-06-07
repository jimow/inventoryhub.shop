-- ============================================================================
-- 00038: Domain + SSL fields for remote servers
--
-- Lets the deployer fully provision a server: reverse-proxy a domain with nginx
-- and issue a Let's Encrypt certificate (certbot) out of the box.
-- Idempotent.
-- ============================================================================
alter table public.platform_servers add column if not exists domain    text;
alter table public.platform_servers add column if not exists ssl_email text;
alter table public.platform_servers add column if not exists setup_ssl boolean not null default true;
alter table public.platform_servers add column if not exists www_alias boolean not null default false;
