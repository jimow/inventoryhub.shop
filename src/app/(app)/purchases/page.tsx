import { createClient, createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedActiveProductsList, getCachedActiveSuppliersList, getCachedPaymentMethods } from "@/lib/cached-lookups";
import { PurchasesClient } from "./purchases-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Purchase, Supplier, Product, PaymentMethod, ReturnLine, PurchaseReturn } from "@/lib/types";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("purchases");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "purchase_type", "supplier_id", "from", "to"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase
    .from("purchases")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.q) query = query.ilike("po_no", `%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.purchase_type) query = query.eq("purchase_type", params.filters.purchase_type);
  if (params.filters.supplier_id) query = query.eq("supplier_id", params.filters.supplier_id);
  if (params.filters.from) query = query.gte("date", params.filters.from);
  if (params.filters.to) query = query.lte("date", params.filters.to);

  const [{ data: purchases, count }, suppliers, products, methods, settings] = await Promise.all([
    query,
    getCachedActiveSuppliersList(),
    getCachedActiveProductsList(),
    getCachedPaymentMethods(),
    getSettings(),
  ]);

  // Flag purchases that have returns (full vs partial) for a "Returned" badge.
  const poRows = (purchases as Purchase[]) || [];
  const returnsByPurchase: Record<string, "full" | "partial"> = {};
  const returnsListByPurchase: Record<string, PurchaseReturn[]> = {};
  if (poRows.length) {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let rq = admin.from("purchase_returns").select("*").eq("status", "posted")
      .in("purchase_id", poRows.map((p) => p.id)).order("created_at", { ascending: false });
    if (tid) rq = rq.eq("tenant_id", tid);
    const { data: rets } = await rq;
    const returnedQty = new Map<string, number>();
    for (const r of (rets as PurchaseReturn[]) || []) {
      const q = ((r.items as ReturnLine[]) || []).reduce((s, l) => s + Number(l.qty), 0);
      returnedQty.set(r.purchase_id as string, (returnedQty.get(r.purchase_id as string) || 0) + q);
      (returnsListByPurchase[r.purchase_id as string] ||= []).push(r);
    }
    for (const p of poRows) {
      const ret = returnedQty.get(p.id) || 0;
      if (ret <= 0) continue;
      const bought = ((p.items as ReturnLine[]) || []).reduce((sum, l) => sum + Number(l.qty), 0);
      returnsByPurchase[p.id] = ret >= bought - 0.001 ? "full" : "partial";
    }
  }

  return (
    <PurchasesClient
      purchases={poRows}
      totalCount={count || 0}
      suppliers={suppliers as Supplier[]}
      products={products as Product[]}
      methods={methods as PaymentMethod[]}
      returnsByPurchase={returnsByPurchase}
      returnsListByPurchase={returnsListByPurchase}
      settings={settings}
      permissions={permissions}
    />
  );
}
