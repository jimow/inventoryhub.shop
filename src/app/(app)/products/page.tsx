import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { ProductsClient } from "./products-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Product } from "@/lib/types";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("products");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "category"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.q)
    query = query.or(`name.ilike.%${params.q}%,code.ilike.%${params.q}%,sku.ilike.%${params.q}%,barcode.ilike.%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.category) query = query.eq("category", params.filters.category);

  const { data: products, count } = await query;
  const settings = await getSettings();

  return (
    <ProductsClient
      products={(products as Product[]) || []}
      totalCount={count || 0}
      settings={settings}
      permissions={permissions}
    />
  );
}
