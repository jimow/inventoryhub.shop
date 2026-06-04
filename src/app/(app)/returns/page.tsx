import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedCustomersList, getCachedSuppliersList, getCachedPaymentMethods } from "@/lib/cached-lookups";
import { ReturnsClient } from "./returns-client";
import type { SalesReturn, PurchaseReturn, Customer, Supplier, Sale, Purchase, Product, PaymentMethod } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  await requireViewPermission("returns");
  const { permissions } = await getCurrentSession();
  const admin = createServiceClient();
  const tid = currentTenantId();

  let srQ = admin.from("sales_returns").select("*").order("created_at", { ascending: false });
  let prQ = admin.from("purchase_returns").select("*").order("created_at", { ascending: false });
  // Returnable source documents (recent, not cancelled/draft).
  let salesQ = admin.from("sales").select("*").in("status", ["confirmed", "paid"]).order("created_at", { ascending: false }).limit(300);
  let poQ = admin.from("purchases").select("*").in("status", ["received", "paid"]).order("created_at", { ascending: false }).limit(300);
  let prodQ = admin.from("products").select("*").order("name");
  if (tid) {
    srQ = srQ.eq("tenant_id", tid); prQ = prQ.eq("tenant_id", tid);
    salesQ = salesQ.eq("tenant_id", tid); poQ = poQ.eq("tenant_id", tid); prodQ = prodQ.eq("tenant_id", tid);
  }

  const [{ data: salesReturns }, { data: purchaseReturns }, { data: sales }, { data: purchases }, { data: products }, customers, suppliers, methods, settings] = await Promise.all([
    srQ, prQ, salesQ, poQ, prodQ,
    getCachedCustomersList(), getCachedSuppliersList(), getCachedPaymentMethods(), getSettings(),
  ]);

  return (
    <ReturnsClient
      salesReturns={(salesReturns as SalesReturn[]) || []}
      purchaseReturns={(purchaseReturns as PurchaseReturn[]) || []}
      returnableSales={(sales as Sale[]) || []}
      returnablePurchases={(purchases as Purchase[]) || []}
      products={(products as Product[]) || []}
      customers={customers as Customer[]}
      suppliers={suppliers as Supplier[]}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
