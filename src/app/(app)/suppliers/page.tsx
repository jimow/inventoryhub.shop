import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { SuppliersClient } from "./suppliers-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Supplier } from "@/lib/types";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("suppliers");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase.from("suppliers").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);

  if (params.q)
    query = query.or(`name.ilike.%${params.q}%,code.ilike.%${params.q}%,email.ilike.%${params.q}%,phone.ilike.%${params.q}%,city.ilike.%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);

  const { data, count } = await query;
  const settings = await getSettings();

  return (
    <SuppliersClient
      suppliers={(data as Supplier[]) || []}
      totalCount={count || 0}
      settings={settings}
      permissions={permissions}
    />
  );
}
