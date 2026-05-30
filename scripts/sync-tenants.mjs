#!/usr/bin/env node
/**
 * Bring EVERY registered shop up to date with the template schema (`public`).
 *
 * Run this once after applying a migration to the template. It adds any new
 * tables/columns, refreshes FKs/triggers/RLS policies/grants, ensures each
 * schema is API-exposed, and adds brand-new default roles. Existing tenant
 * role permissions are left untouched.
 *
 * Usage:
 *   npm run sync:tenants            # template = public
 *   npm run sync:tenants -- other_template
 *
 * Required env: SUPABASE_DB_URL  (and the keys in .env.local / .env.provisioning)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_SQL = path.join(HERE, "..", "supabase", "provisioning", "install.sql");

const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };

function loadEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnvFile(path.join(process.cwd(), ".env.local")),
              ...loadEnvFile(path.join(process.cwd(), ".env.provisioning")) };
const DB_URL = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;
if (!DB_URL) die("Missing SUPABASE_DB_URL (Supabase > Settings > Database > Connection string).");

const template = process.argv.slice(2).find((a) => !a.startsWith("--")) || "public";

let pg;
try { pg = (await import("pg")).default; } catch { die('The "pg" package is required. Run: npm install'); }

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
console.log(`\nSyncing all tenants from template "${template}"\n`);
try {
  await db.connect();
  await db.query(fs.readFileSync(INSTALL_SQL, "utf8")); // refresh functions first
  const res = await db.query("select * from public.tenant_sync_all($1)", [template]);
  if (!res.rows.length) { console.log("  (no tenants registered yet)\n"); }
  for (const row of res.rows) {
    const mark = row.status === "ok" ? "✓" : "✗";
    console.log(`  ${mark} ${row.schema_name} — ${row.status}`);
  }
  const failed = res.rows.filter((r) => r.status !== "ok").length;
  console.log(`\n${failed ? "⚠" : "✅"} Done — ${res.rows.length - failed}/${res.rows.length} synced.\n`);
  if (failed) process.exit(1);
} finally {
  await db.end().catch(() => {});
}
