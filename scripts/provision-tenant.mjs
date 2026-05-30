#!/usr/bin/env node
/**
 * Provision a new shop (tenant) — fully automatic, no manual SQL or dashboard.
 *
 * Schema-per-tenant: creates the shop's Postgres schema, clones the table
 * structure from a template, applies RLS + seeds roles/settings, creates the
 * first admin login, EXPOSES the schema to the API, and writes this folder's
 * .env.local so the deployment is pinned to that schema.
 *
 * It also (idempotently) installs/updates the provisioning SQL on every run,
 * so there is no separate one-time setup step.
 *
 * Usage:
 *   npm run provision:tenant -- [path/to/tenant.config.json] [--out <folder>]
 *
 * Required env (from Supabase dashboard; put in .env.local or .env.provisioning):
 *   SUPABASE_DB_URL                  Postgres connection string (Settings > Database)
 *   NEXT_PUBLIC_SUPABASE_URL         project URL
 *   SUPABASE_SERVICE_ROLE_KEY        service role key
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY    anon key
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_SQL = path.join(HERE, "..", "supabase", "provisioning", "install.sql");
const SCHEMA_RE = /^[a-z][a-z0-9_]{1,40}$/;

const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };
const info = (m) => console.log(`  ${m}`);
const ok = (m) => console.log(`✓ ${m}`);

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

async function getPg() {
  let pg;
  try { pg = (await import("pg")).default; }
  catch { die('The "pg" package is required. Run: npm install'); }
  return pg;
}

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2);
let configPath = "tenant.config.json";
let outDir = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = args[++i];
  else if (!args[i].startsWith("--")) configPath = args[i];
}
configPath = path.resolve(configPath);
outDir = path.resolve(outDir);

if (!fs.existsSync(configPath)) {
  die(`Config not found: ${configPath}\nCopy scripts/tenant.config.example.json and edit it.`);
}
let config;
try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
catch (e) { die(`Could not parse ${configPath}: ${e.message}`); }

// ---- env -------------------------------------------------------------------
const env = { ...loadEnvFile(path.join(process.cwd(), ".env.local")),
              ...loadEnvFile(path.join(process.cwd(), ".env.provisioning")) };
const get = (k) => process.env[k] || env[k];
const DB_URL = get("SUPABASE_DB_URL");
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!DB_URL) die("Missing SUPABASE_DB_URL (Supabase > Settings > Database > Connection string).");
if (!URL || !SERVICE_KEY) die("Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.");

// ---- validate config -------------------------------------------------------
const schema = String(config.schema || "").trim();
if (!SCHEMA_RE.test(schema)) die(`Invalid "schema": "${schema}". Use lower_snake_case, 2-41 chars (e.g. shop_mombasa).`);
const admin = config.admin || {};
if (!admin.email || !admin.password) die("Config must include admin.email and admin.password.");
const adminUsername = admin.username || String(admin.email).split("@")[0];
const adminFullName = admin.fullName || adminUsername;

const overrides = {};
for (const k of ["company", "currency", "tax", "locale"]) if (config[k]) overrides[k] = config[k];
const template = config.template || "public";

// ---- run -------------------------------------------------------------------
const pg = await getPg();
const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
console.log(`\nProvisioning shop "${config.company?.name || schema}" → schema "${schema}"\n`);

try {
  await db.connect();

  // 0) Ensure provisioning functions exist / are up to date (idempotent).
  await db.query(fs.readFileSync(INSTALL_SQL, "utf8"));
  ok("Provisioning functions installed/updated");

  // 1) Create schema + clone + RLS + seed + register
  const prov = await db.query("select public.tenant_provision($1, $2::jsonb, $3) as schema",
    [schema, JSON.stringify(overrides), template]);
  ok(`Schema "${prov.rows[0].schema}" created, cloned from "${template}", RLS + seed applied`);

  // 2) Create the admin auth user (Auth Admin API)
  const supabase = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let userId;
  const { data, error } = await supabase.auth.admin.createUser({
    email: admin.email, password: admin.password, email_confirm: true,
    user_metadata: { full_name: adminFullName, username: adminUsername },
  });
  if (error && /already.*regist|exists/i.test(error.message)) {
    info("Admin user already exists — looking it up");
    let page = 1, found;
    for (;;) {
      const { data: list, error: lerr } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (lerr) die(`Could not list users: ${lerr.message}`);
      found = list.users.find((u) => u.email?.toLowerCase() === admin.email.toLowerCase());
      if (found || list.users.length < 200) break;
      page++;
    }
    if (!found) die(`Admin user ${admin.email} exists but could not be found.`);
    userId = found.id;
  } else if (error) {
    die(`Could not create admin user: ${error.message}`);
  } else {
    userId = data.user.id;
  }
  ok(`Admin user ready: ${admin.email}`);

  // 3) Link Administrator profile in the tenant schema
  await db.query("select public.tenant_create_admin($1, $2, $3, $4, $5)",
    [schema, userId, adminUsername, adminFullName, admin.email]);
  ok("Admin profile linked with Administrator role");

  // 4) Expose the schema to PostgREST (automatic)
  const exp = await db.query("select public.tenant_ensure_exposed($1) as r", [schema]);
  const expMsg = exp.rows[0].r;
  if (typeof expMsg === "string" && expMsg.startsWith("MANUAL")) info(`⚠ ${expMsg}`);
  else ok(`API ${expMsg}`);
} finally {
  await db.end().catch(() => {});
}

// 5) Write this folder's .env.local pinned to the schema.
// IMPORTANT: start from the EXISTING .env.local (if any) so we never wipe
// values the operator already set (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_URL,
// M-Pesa keys, etc.). Only fall back to the example for a brand-new folder.
{
  const envPath = path.join(outDir, ".env.local");
  const examplePath = path.join(outDir, ".env.local.example");
  let base = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : (fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "");
  const set = (src, key, val) => {
    if (val === undefined || val === null || val === "") return src; // don't blank-out
    const re = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${val}`;
    return re.test(src) ? src.replace(re, line) : src + (src && !src.endsWith("\n") ? "\n" : "") + line + "\n";
  };
  base = set(base, "NEXT_PUBLIC_SUPABASE_URL", URL);
  base = set(base, "NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY || "FILL_ME");
  base = set(base, "SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  base = set(base, "TENANT_SCHEMA", schema);
  base = set(base, "NEXT_PUBLIC_TENANT_SCHEMA", schema);
  // Carry the provisioning secrets forward only if we actually have them.
  base = set(base, "SUPABASE_DB_URL", DB_URL);
  base = set(base, "SUPABASE_ACCESS_TOKEN", get("SUPABASE_ACCESS_TOKEN"));
  if (fs.existsSync(envPath)) { fs.copyFileSync(envPath, envPath + ".bak"); info("Backed up existing .env.local → .env.local.bak"); }
  fs.writeFileSync(envPath, base);
  ok(`Wrote ${envPath} (TENANT_SCHEMA=${schema})`);
}

console.log(`\n✅ Shop "${schema}" is ready.`);
console.log(`   • Login: ${admin.email}`);
console.log(`   • Start this deployment:  npm run dev\n`);
