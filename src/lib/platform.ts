// Server-only. The platform (super-admin) control plane.
//
// Unlike the rest of the app — which is pinned to ONE tenant via
// tenant.config.local.json / TENANT_ID and scopes every query to it — the
// platform console operates ACROSS all tenants. It therefore uses a dedicated
// service-role client that sends NO x-tenant-id header and always targets the
// shared `public` schema. service_role bypasses RLS, so platform code is fully
// responsible for what it reads/writes.

import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { TENANT_STATUS_META, type TenantStatus, type TenantOverviewRow } from "@/lib/platform-shared";

// Re-export the client-safe pieces so existing server-side imports keep working.
export { TENANT_STATUS_META };
export type { TenantStatus, TenantOverviewRow };

export type PlatformSession = {
  userId: string;
  email: string | null;
  name: string | null;
};

/**
 * A service-role client with NO tenant header, pinned to `public`. Reads and
 * writes span every tenant — use only inside platform-admin code paths.
 */
export function createPlatformClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: "public" },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

/** A cookie-bound anon client for reading the signed-in Supabase user (no tenant header). */
export async function createPlatformAuthClient() {
  return createAuthClient();
}

async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* read-only in a Server Component */
          }
        },
      },
    }
  );
}

/** Has the platform been claimed yet? (false ⇒ first-run /platform/setup is open) */
export const platformHasAdmins = cache(async function _platformHasAdmins(): Promise<boolean> {
  const admin = createPlatformClient();
  const { count } = await admin.from("platform_admins").select("*", { count: "exact", head: true });
  return (count ?? 0) > 0;
});

/** Is this auth user a registered platform admin? */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createPlatformClient();
  const { data } = await admin.from("platform_admins").select("id").eq("id", userId).maybeSingle();
  return Boolean(data);
}

/** The current platform-admin session, or null if not signed in as one. */
export const getPlatformSession = cache(async function _getPlatformSession(): Promise<PlatformSession | null> {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createPlatformClient();
  const { data } = await admin
    .from("platform_admins")
    .select("id, email, name")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;

  return { userId: user.id, email: data.email ?? user.email ?? null, name: data.name ?? null };
});

/** Page-level gate for /platform console routes. */
export async function requirePlatformAdmin(): Promise<PlatformSession> {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return session;
}

/** Record a platform-admin action in the immutable audit trail. Never throws. */
export async function logPlatformAction(opts: {
  action: string;
  tenantId?: string | null;
  tenantName?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const session = await getPlatformSession();
    const admin = createPlatformClient();
    await admin.from("platform_audit").insert({
      admin_id: session?.userId ?? null,
      admin_email: session?.email ?? null,
      action: opts.action,
      tenant_id: opts.tenantId ?? null,
      tenant_name: opts.tenantName ?? null,
      detail: opts.detail ?? {},
    });
  } catch {
    /* audit logging must never break the action */
  }
}

/** Per-tenant usage + health rollup for the whole platform (single round trip). */
export async function getTenantOverview(): Promise<TenantOverviewRow[]> {
  const admin = createPlatformClient();
  const { data, error } = await admin.rpc("platform_tenant_overview");
  if (error || !data) return [];
  return (data as TenantOverviewRow[]).map((r) => ({
    ...r,
    users: Number(r.users) || 0,
    products: Number(r.products) || 0,
    customers: Number(r.customers) || 0,
    suppliers: Number(r.suppliers) || 0,
    sales: Number(r.sales) || 0,
    sales_total: Number(r.sales_total) || 0,
    purchases: Number(r.purchases) || 0,
    purchases_total: Number(r.purchases_total) || 0,
  }));
}
