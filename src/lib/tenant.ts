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
import os from "node:os";
import path from "node:path";

const CONFIG_FILE = path.join(process.cwd(), "tenant.config.local.json");

export type TenantConfig = {
  /** Shared-schema model: the tenant row id. Preferred going forward. */
  tenantId?: string;
  /** Legacy schema-per-tenant model. */
  schema?: string;
  installed: boolean;
  companyName?: string;
  /**
   * The folder + machine this install was set up in. Used to detect a COPIED
   * deployment: if you copy the whole folder to a new location, the config
   * travels with it, but `boundPath`/`boundHost` won't match the new folder —
   * so we treat the copy as fresh and route it to /install instead of silently
   * serving the source shop's data.
   */
  boundPath?: string;
  boundHost?: string;
  /**
   * Whether THIS deployment is the cross-tenant platform/super-admin console.
   * Deployed shops set this to false so /platform (and the test module) are not
   * exposed on a tenant's public URL — which would be a serious security hole
   * since all shops share one database.
   */
  platformConsole?: boolean;
};

/** This deployment's folder + host signature. */
function hereSignature(): { boundPath: string; boundHost: string } {
  return { boundPath: path.resolve(process.cwd()), boundHost: os.hostname() };
}

/** Compare two filesystem paths, case-insensitively on Windows. */
function samePath(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * Does a saved config belong to THIS folder (vs. a copy)? Decision is by folder
 * path only — reliable across machines and OSes. `boundHost` is recorded for
 * diagnostics but never used to fail the check (os.hostname() forms vary and a
 * false positive would wrongly hide a live shop behind /install).
 */
function isBoundHere(cfg: TenantConfig): boolean {
  // Legacy configs written before location-binding have no boundPath — adopt
  // them for whichever folder first runs them (see readConfig).
  if (!cfg.boundPath) return true;
  return samePath(cfg.boundPath, process.cwd());
}

// Only a POSITIVE (installed) result is cached. We must never cache "not
// installed", or the /install page and app layout would keep using that stale
// value after the wizard writes the config — leaving you stuck on /install.
let cache: TenantConfig | null = null;

function readConfig(): TenantConfig | null {
  if (cache?.installed) return cache;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as TenantConfig;
    if (!cfg?.installed) return cfg;

    // A config that was copied here from another folder is NOT this folder's
    // install — behave as if there's no config so a fresh /install runs and a
    // separate tenant gets provisioned (its own data).
    if (!isBoundHere(cfg)) return null;

    // Legacy config with no boundPath: stamp it to this folder so any future
    // COPY of this folder is correctly detected as a different deployment.
    if (!cfg.boundPath) {
      try {
        const stamped = { ...cfg, ...hereSignature() };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(stamped, null, 2));
        cache = stamped;
        return stamped;
      } catch {
        // Read-only FS — can't stamp, but it's still this folder's install.
      }
    }

    cache = cfg; // cache once truly installed & bound here
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

/**
 * Whether the cross-tenant platform/super-admin console is exposed on THIS
 * deployment. Resolution order:
 *   1. PLATFORM_CONSOLE_ENABLED env ("true"/"1" = on, anything else = off)
 *   2. tenant.config.local.json `platformConsole === false` ⇒ off (set by the
 *      deploy / install for tenant shops)
 *   3. default ⇒ on (so the operator's own console keeps working)
 * Deployed shops are off, so /platform 404s on a tenant's public URL.
 */
export function isPlatformConsoleEnabled(): boolean {
  const env = process.env.PLATFORM_CONSOLE_ENABLED;
  if (env && env.trim()) return env === "true" || env === "1";
  try {
    const cfg = readConfig();
    if (cfg && cfg.platformConsole === false) return false;
  } catch {
    /* fall through to default */
  }
  return true;
}

/** Whether this deployment has been set up. */
export function isInstalled(): boolean {
  if (process.env.TENANT_ID?.trim() || process.env.TENANT_SCHEMA?.trim()) return true;
  return Boolean(readConfig()?.installed);
}

/** Persist the wizard's choice so the deployment is pinned to its schema.
 *  Records the folder + host so a later COPY of this folder is recognised as a
 *  separate deployment and gets its own fresh /install. */
export function saveTenantConfig(cfg: TenantConfig): void {
  const full = { ...cfg, ...hereSignature() };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(full, null, 2));
  cache = full;
}
