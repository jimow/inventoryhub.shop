import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedActiveProductsList, getCachedActiveSuppliersList, getCachedPaymentMethods } from "@/lib/cached-lookups";
import { PurchasesClient } from "./purchases-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Purchase, Supplier, Product, PaymentMethod } from "@/lib/types";

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

  return (
    <PurchasesClient
      purchases={(purchases as Purchase[]) || []}
      totalCount={count || 0}
      suppliers={suppliers as Supplier[]}
      products={products as Product[]}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
