# Inventory Management System — Next.js + Supabase

A complete, production-ready inventory management system built with **Next.js 15** (App Router), **Supabase** (Postgres + Auth + RLS), **TypeScript**, **Tailwind CSS**, and **shadcn/ui**.

## Features

- **Modules**: Items, Products (with BOM), Customers, Suppliers, Sales, Purchases
- **Admin**: Users, Roles & Permissions (granular per-module per-action), Settings
- **Auth**: Email/password via Supabase Auth
- **Permissions**: Postgres RLS enforces every read/write based on role permissions
- **Stock movements**: Auto stock deduction on sale confirm; auto receipt on purchase received
- **Settings**: Company info, currency, tax, document numbering, categories, units, payment terms — extensible

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

- Go to https://app.supabase.com and create a new project
- Copy the **Project URL** and **anon key** from Settings → API
- Copy the **service_role key** (keep secret — only used server-side)

### 3. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

### 4. Run the database migrations

In Supabase Studio → SQL Editor, run the migrations **in order**:

1. `supabase/migrations/00001_schema.sql` — tables
2. `supabase/migrations/00002_rls.sql` — row-level security policies
3. `supabase/migrations/00003_seed.sql` — default roles, settings, sample data

> If you have the Supabase CLI installed, you can also run `supabase db push`.

### 5. Create your admin user

Sign up your first user via Supabase Auth (or directly in the app at `/login` → "Sign Up"). The first user created automatically becomes the **Administrator**. Subsequent users get no role until an admin assigns one.

Alternatively, in Supabase Studio → Authentication → Users → Add user, create an admin email/password, then in SQL Editor:

```sql
update profiles set role_id = (select id from roles where name='Administrator')
where email = 'admin@example.com';
```

### 6. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000 and sign in.

## Architecture

```
src/
  app/
    login/          — sign-in page
    (app)/          — authenticated app routes
      layout.tsx    — sidebar + topbar shell
      dashboard/    — KPIs and alerts
      items/        — raw materials / inventory items
      products/     — finished goods (with BOM)
      customers/    — customer directory
      suppliers/    — supplier directory
      sales/        — sales orders / invoices
      purchases/    — purchase orders
      users/        — user management
      roles/        — role + permission matrix
      settings/     — company / currency / numbering / categories ...
  components/
    ui/             — shadcn/ui base components
    sidebar.tsx     — module nav (filtered by permissions)
    topbar.tsx
    data-table.tsx  — generic table with search + actions
  lib/
    supabase/       — server, browser, and middleware clients
    permissions.ts  — module/action constants + helpers
    types.ts        — DB row types
    utils.ts        — money/date helpers, cn()
supabase/migrations — SQL schema, RLS policies, seed
```

## Permission Model

Roles store permissions as JSONB:

```json
{
  "items":     { "view": true, "create": true, "edit": true, "delete": false },
  "sales":     { "view": true, "create": true, "edit": true, "delete": false },
  "settings":  { "view": false, "create": false, "edit": false, "delete": false }
}
```

A Postgres function `has_permission(uid, module, action)` checks the user's role permissions, and every table's RLS policies call it. The frontend also uses these flags to hide menu items, buttons, and forms.

Pre-seeded roles: **Administrator**, **Manager**, **Sales**, **Purchasing**, **Viewer**.

## Production deploy

This is a standard Next.js app — deploy to Vercel, Fly, Render, or any Node host. Set the same env vars in your host's dashboard.

```bash
npm run build
npm start
```
