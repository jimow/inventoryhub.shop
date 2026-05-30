// Server-only. Resolves which tenant schema this deployment serves and whether
// it has been installed yet.
//
// Two ways a deployment knows its schema:
//   1. TENANT_SCHEMA env var — pin it explicitly (best for fixed / serverless
//      deployments). Any non-empty value counts as "installed".
//   2. The /install web wizard — writes tenant.config.local.json at the project
//      root. Used when TENANT_SCHEMA is left unset, so a freshly-copied folder
//      can be set up from the browser with no env editing.
import fs from "node:fs";
import path from "node:path";

const CONFIG_FILE = path.join(process.cwd(), "tenant.config.local.json");

export type TenantConfig = {
  /** Shared-schema model: the tenant row id. Preferred going forward. */
  tenantId?: string;
  /** Legacy schema-per-tenant model. */
  schema?: string;
  installed: boolean;
  companyName?: string;
};

// Only a POSITIVE (installed) result is cached. We must never cache "not
// installed", or the /install page and app layout would keep using that stale
// value after the wizard writes the config — leaving you stuck on /install.
let cache: TenantConfig | null = null;

function readConfig(): TenantConfig | null {
  if (cache?.installed) return cache;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as TenantConfig;
    if (cfg?.installed) cache = cfg; // cache once truly installed
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Shared-schema model: the tenant id this deployment serves, or null if this
 * deployment still uses the legacy schema-per-tenant model.
 */
export function activeTenantId(): string | null {
  const env = process.env.TENANT_ID;
  if (env && env.trim()) return env.trim();
  return readConfig()?.tenantId || null;
}

/** The Postgres schema for this deployment. Shared-tenancy uses `public`. */
export function activeSchema(): string {
  if (activeTenantId()) return "public";
  const env = process.env.TENANT_SCHEMA;
  if (env && env.trim()) return env.trim();
  return readConfig()?.schema || "public";
}

/** Whether this deployment has been set up. */
export function isInstalled(): boolean {
  if (process.env.TENANT_ID?.trim() || process.env.TENANT_SCHEMA?.trim()) return true;
  return Boolean(readConfig()?.installed);
}

/** Persist the wizard's choice so the deployment is pinned to its schema. */
export function saveTenantConfig(cfg: TenantConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  cache = cfg;
}
