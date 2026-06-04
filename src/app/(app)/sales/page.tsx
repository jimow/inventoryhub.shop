import { createClient, createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedCustomersList, getCachedActiveProductsList, getCachedPaymentMethods } from "@/lib/cached-lookups";
import { SalesClient } from "./sales-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Sale, Customer, Product, PaymentMethod, ReturnLine, SalesReturn } from "@/lib/types";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("sales");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "sale_type", "customer_id", "from", "to"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase
    .from("sales")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.q) query = query.ilike("invoice_no", `%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.sale_type) query = query.eq("sale_type", params.filters.sale_type);
  if (params.filters.customer_id) query = query.eq("customer_id", params.filters.customer_id);
  if (params.filters.from) query = query.gte("date", params.filters.from);
  if (params.filters.to) query = query.lte("date", params.filters.to);

  const [{ data: sales, count }, customers, products, methods, settings] = await Promise.all([
    query,
    getCachedCustomersList(),
    getCachedActiveProductsList(),
    getCachedPaymentMethods(),
    getSettings(),
  ]);

  // Mark which of these sales have returns (full vs partial), so the list can
  // show a "Returned" badge. Read via service client (scoped to tenant) so the
  // badge shows even for users without the returns permission.
  const saleRows = (sales as Sale[]) || [];
  const returnsBySale: Record<string, "full" | "partial"> = {};
  const returnsListBySale: Record<string, SalesReturn[]> = {};
  if (saleRows.length) {
    const admin = createServiceClient();
    const tid = currentTenantId();
    let rq = admin.from("sales_returns").select("*").eq("status", "posted")
      .in("sale_id", saleRows.map((s) => s.id)).order("created_at", { ascending: false });
    if (tid) rq = rq.eq("tenant_id", tid);
    const { data: rets } = await rq;
    const returnedQty = new Map<string, number>();
    for (const r of (rets as SalesReturn[]) || []) {
      const q = ((r.items as ReturnLine[]) || []).reduce((s, l) => s + Number(l.qty), 0);
      returnedQty.set(r.sale_id as string, (returnedQty.get(r.sale_id as string) || 0) + q);
      (returnsListBySale[r.sale_id as string] ||= []).push(r);
    }
    for (const s of saleRows) {
      const ret = returnedQty.get(s.id) || 0;
      if (ret <= 0) continue;
      const sold = ((s.items as ReturnLine[]) || []).reduce((sum, l) => sum + Number(l.qty), 0);
      returnsBySale[s.id] = ret >= sold - 0.001 ? "full" : "partial";
    }
  }

  return (
    <SalesClient
      sales={saleRows}
      totalCount={count || 0}
      customers={customers as Customer[]}
      products={products as Product[]}
      methods={methods as PaymentMethod[]}
      returnsBySale={returnsBySale}
      returnsListBySale={returnsListBySale}
      settings={settings}
      permissions={permissions}
    />
  );
}
