/**
 * Cross-request cached fetches for reference tables used as dropdown options.
 * Uses createServiceClient (no session cookies) so they are safe inside
 * unstable_cache. TTL: 30-60 s. Server actions that mutate these tables
 * should call revalidateTag with the matching tag to flush early.
 *
 * Service role bypasses RLS, so every query is scoped to the active tenant.
 * (Each deployment serves one tenant, so the static cache keys are fine.)
 */
import { unstable_cache } from "next/cache";
import { createServiceClient, currentTenantId } from "@/lib/supabase/server";

export const getCachedCustomersList = unstable_cache(
  async () => {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin.from("customers").select("id, name").order("name");
    if (tid) q = q.eq("tenant_id", tid);
    const { data } = await q;
    return data ?? [];
  },
  ["ref-customers"],
  { revalidate: 30, tags: ["ref-customers"] }
);

export const getCachedSuppliersList = unstable_cache(
  async () => {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin.from("suppliers").select("id, name, opening_balance").order("name");
    if (tid) q = q.eq("tenant_id", tid);
    const { data } = await q;
    return data ?? [];
  },
  ["ref-suppliers"],
  { revalidate: 30, tags: ["ref-suppliers"] }
);

export const getCachedPaymentMethods = unstable_cache(
  async () => {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin.from("payment_methods").select("*").eq("is_active", true).order("name");
    if (tid) q = q.eq("tenant_id", tid);
    const { data } = await q;
    return data ?? [];
  },
  ["ref-payment-methods"],
  { revalidate: 60, tags: ["ref-payment-methods"] }
);

export const getCachedActiveAccounts = unstable_cache(
  async () => {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin.from("accounts").select("code, name, type").eq("is_active", true).order("code");
    if (tid) q = q.eq("tenant_id", tid);
    const { data } = await q;
    return data ?? [];
  },
  ["ref-accounts"],
  { revalidate: 60, tags: ["ref-accounts"] }
);

export const getCachedActiveProductsList = unstable_cache(
  async () => {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin
      .from("products")
      .select("id, name, code, unit, cost_price, selling_price, current_stock, min_stock, serial_tracked")
      .eq("status", "active")
      .order("name");
    if (tid) q = q.eq("tenant_id", tid);
    const { data } = await q;
    return data ?? [];
  },
  ["ref-products-active"],
  { revalidate: 30, tags: ["ref-products"] }
);

export const getCachedActiveSuppliersList = unstable_cache(
  async () => {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin.from("suppliers").select("id, name").eq("status", "active").order("name");
    if (tid) q = q.eq("tenant_id", tid);
    const { data } = await q;
    return data ?? [];
  },
  ["ref-suppliers-active"],
  { revalidate: 30, tags: ["ref-suppliers"] }
);
