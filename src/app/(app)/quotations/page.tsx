import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedCustomersList, getCachedActiveProductsList } from "@/lib/cached-lookups";
import { QuotationsClient } from "./quotations-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Quotation, Customer, Product } from "@/lib/types";

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("quotations");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "customer_id", "from", "to"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase
    .from("quotations")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.q) query = query.ilike("quote_no", `%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.customer_id) query = query.eq("customer_id", params.filters.customer_id);
  if (params.filters.from) query = query.gte("date", params.filters.from);
  if (params.filters.to) query = query.lte("date", params.filters.to);

  const [{ data: quotations, count }, customers, products, settings] = await Promise.all([
    query,
    getCachedCustomersList(),
    getCachedActiveProductsList(),
    getSettings(),
  ]);

  return (
    <QuotationsClient
      quotations={(quotations as Quotation[]) || []}
      totalCount={count || 0}
      customers={customers as Customer[]}
      products={products as Product[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
