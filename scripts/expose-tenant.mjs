#!/usr/bin/env node
/**
 * Expose a tenant schema to the Supabase API (and reload PostgREST) without
 * re-provisioning. Fixes "Could not find the table '<schema>.<table>' in the
 * schema cache".
 *
 * Usage:
 *   npm run expose:tenant -- shop_quality_electronics
 *
 * Prefers the Supabase Management API (set SUPABASE_ACCESS_TOKEN — create one at
 * https://supabase.com/dashboard/account/tokens). Falls back to SQL via
 * SUPABASE_DB_URL.
 */
import fs from "node:fs";
import path from "node:path";

const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };
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

const env = { ...loadEnvFile(path.join(process.cwd(), ".env.local")),
              ...loadEnvFile(path.join(process.cwd(), ".env.provisioning")) };
const get = (k) => process.env[k] || env[k];

const schema = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!schema || !/^[a-z][a-z0-9_]{1,40}$/.test(schema)) {
  die("Usage: npm run expose:tenant -- <schema>  (lower_snake_case)");
}

const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const TOKEN = get("SUPABASE_ACCESS_TOKEN");
const DB_URL = get("SUPABASE_DB_URL");

function projectRef(u) {
  try { const h = new URL(u).hostname; const r = h.split(".")[0]; return r && r !== "localhost" ? r : null; }
  catch { return null; }
}

const ref = projectRef(URL);

if (TOKEN && ref) {
  const base = `https://api.supabase.com/v1/projects/${ref}/postgrest`;
  const getRes = await fetch(base, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!getRes.ok) die(`Management API GET failed (${getRes.status}). Check SUPABASE_ACCESS_TOKEN / project.`);
  const cfg = await getRes.json();
  const tokens = String(cfg.db_schema || "public, graphql_public").split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.includes(schema)) { ok(`Already exposed: ${tokens.join(", ")}`); process.exit(0); }
  tokens.push(schema);
  const patch = await fetch(base, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ db_schema: tokens.join(", ") }),
  });
  if (!patch.ok) die(`Management API PATCH failed (${patch.status}).`);
  ok(`Exposed via Management API. Exposed schemas: ${tokens.join(", ")}`);
  console.log("\n✅ PostgREST will reload automatically. Refresh the app.\n");
  process.exit(0);
}

if (DB_URL) {
  let pg;
  try { pg = (await import("pg")).default; } catch { die('Need "pg" for the SQL fallback: npm install'); }
  const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "supabase", "provisioning", "install.sql"), "utf8"));
    const r = await db.query("select public.tenant_ensure_exposed($1) as r", [schema]);
    ok(`SQL exposure: ${r.rows[0].r}`);
    await db.query("notify pgrst, 'reload schema'");
    console.log("\n✅ Done. Refresh the app. If it still fails, add the schema in Settings → API → Exposed schemas.\n");
  } finally {
    await db.end().catch(() => {});
  }
  process.exit(0);
}

die("Set SUPABASE_ACCESS_TOKEN (recommended) or SUPABASE_DB_URL, then re-run.");
