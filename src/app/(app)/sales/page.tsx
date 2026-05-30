import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedCustomersList, getCachedActiveProductsList, getCachedPaymentMethods } from "@/lib/cached-lookups";
import { SalesClient } from "./sales-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Sale, Customer, Product, PaymentMethod } from "@/lib/types";

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

  return (
    <SalesClient
      sales={(sales as Sale[]) || []}
      totalCount={count || 0}
      customers={customers as Customer[]}
      products={products as Product[]}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
