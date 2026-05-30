# Multi-tenant setup (schema-per-tenant)

One Supabase database serves many shops. Each shop ("tenant") lives in its own
Postgres **schema** (e.g. `shop_mombasa`) with the same table structure as the
template schema (`public`, built by the migrations). No database is ever
recreated; a new shop is just a new schema cloned from the template.

Each shop runs from **its own app folder**, whose `.env.local` pins it to its
schema via `TENANT_SCHEMA` / `NEXT_PUBLIC_TENANT_SCHEMA`. The Supabase clients
(`src/lib/supabase/*.ts`) read that and route every query through PostgREST to
the right schema.

```
Supabase project (1 database)
├── public         ← template: all tables (migrations) + provisioning functions
├── shop_mombasa   ← tenant: cloned tables, own roles/settings/users
├── shop_nairobi   ← tenant
└── auth           ← shared Supabase Auth (one user pool)
```

Everything is automatic — there is **no manual SQL and no dashboard step**. The
scripts talk to Postgres directly (via `SUPABASE_DB_URL`) and install/refresh
the provisioning functions themselves on every run.

## Setup (once)

1. `npm install` (pulls in `pg`, used only by the scripts).
2. Put these in the repo's `.env.local` (or a `.env.provisioning`), all from the
   Supabase dashboard:
   - `SUPABASE_DB_URL` — Settings → Database → Connection string (URI)
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Make sure your migrations are applied to `public` (the template).

## Provision a shop — option A: the /install web wizard (recommended)

Copy this whole app folder to the new server, set the Supabase env vars
(`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and ideally `SUPABASE_DB_URL`) but **leave
`TENANT_SCHEMA` unset**, then start the app and open **`/install`**. Fill in the
shop details and submit — the schema + tables are created, the admin login is
made, the schema is exposed, and a `tenant.config.local.json` is written to pin
this deployment to its schema. Until set up, every route redirects to
`/install`.

`SUPABASE_DB_URL` lets the wizard auto-install the provisioning functions and
reliably expose the schema. Without it, the wizard uses the service-role API and
the functions must already exist (run `install.sql` once, or use the CLI).

## Provision a shop — option B: CLI

1. Copy `scripts/tenant.config.example.json`, edit it (schema name, company,
   currency, tax, first admin login).
2. Run it — pointing `--out` at the folder that will run this shop:

   ```bash
   npm run provision:tenant -- path/to/tenant.config.json --out ./shops/mombasa
   ```

   In one shot this:
   - installs/updates the provisioning functions (idempotent),
   - creates the schema and clones the table structure (no data) from the template,
   - applies RLS + a per-schema `has_permission`, grants API access,
   - seeds default roles + the shop's `settings` row (counters reset to 1),
   - creates the first admin (Auth Admin API) and links an Administrator profile,
   - **exposes the schema to the API automatically** (`ALTER ROLE authenticator …`
     + `NOTIFY pgrst`),
   - writes the folder's `.env.local` pinned to the schema.

3. `npm run dev` in that folder. Done.

## After a migration (upgrade all shops)

Apply the migration to `public`, then:

```bash
npm run sync:tenants
```

This brings **every registered shop** up to the template: adds new
tables/columns, refreshes FKs/triggers/RLS/grants, re-exposes schemas, and adds
brand-new default roles. It prints a per-shop ✓/✗ report. Existing tenant role
permissions are never overwritten.

## Notes & limitations

- **`public` is the template, not a live shop.** Keep real shop data in tenant
  schemas only. (The global `on_auth_user_created` trigger still writes a
  `public.profiles` row per new auth user — harmless noise; the app and the
  provisioner write the real profile into the tenant schema.)
- **One auth pool.** A person who manages two shops can reuse the same email;
  `tenant_create_admin` is safe to link an existing user into another schema.
- **Schema changes after launch** are handled by `npm run sync:tenants` (see
  above) — no per-schema SQL. Note the sync only adds NOT NULL on new columns
  when they have a default (safe against existing rows), and never rewrites
  existing role permissions.
- **Scale.** Schema-per-tenant suits up to ~hundreds of shops. Far beyond that,
  switch to a shared-schema + `tenant_id` + RLS model.
- The provisioning functions are `SECURITY DEFINER` and callable only by
  `service_role`.
