import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { activeSchema, activeTenantId } from "@/lib/tenant";

type CookiePayload = { name: string; value: string; options?: Record<string, unknown> };

/**
 * The Postgres schema this deployment serves. Shared-tenancy uses `public`;
 * the legacy schema-per-tenant model uses the shop's own schema.
 */
export function tenantSchema(): string {
  return activeSchema();
}

/**
 * Global headers for the Supabase clients. In shared-tenancy mode we send the
 * tenant id so the DB (current_tenant_id(), RLS, column defaults) scopes every
 * request to this shop.
 */
function tenantHeaders(): Record<string, string> | undefined {
  const id = activeTenantId();
  return id ? { "x-tenant-id": id } : undefined;
}

export async function createClient() {
  const cookieStore = await cookies();
  const headers = tenantHeaders();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: tenantSchema() },
      ...(headers ? { global: { headers } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookiePayload[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Read-only when called from a Server Component.
          }
        },
      },
    }
  );
}

export function createServiceClient() {
  const headers = tenantHeaders();
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: tenantSchema() },
      ...(headers ? { global: { headers } } : {}),
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

/**
 * The current tenant id (shared-tenancy mode) or null. Application code that
 * uses the service-role client to READ tenant data must scope by this, because
 * service_role bypasses RLS. New rows are auto-tagged by the DB default, but
 * reads are not filtered for service_role.
 */
export function currentTenantId(): string | null {
  return activeTenantId();
}
