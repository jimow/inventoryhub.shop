import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedPaymentMethods } from "@/lib/cached-lookups";
import { StoreClient, type StoreRow } from "./store-client";
import type { PaymentMethod } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StorePage() {
  await requireViewPermission("store");
  const { permissions } = await getCurrentSession();
  const admin = createServiceClient();
  const tid = currentTenantId();
  let q = admin.from("products")
    .select("id, code, name, unit, current_stock, store_stock, min_stock, serial_tracked, status")
    .eq("status", "active")
    .order("name");
  if (tid) q = q.eq("tenant_id", tid);
  const [{ data: products }, methods, settings] = await Promise.all([
    q, getCachedPaymentMethods(), getSettings(),
  ]);

  return (
    <StoreClient
      products={(products as StoreRow[]) || []}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
