import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedPaymentMethods } from "@/lib/cached-lookups";
import { EmployeesClient } from "./employees-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Employee, PaymentMethod } from "@/lib/types";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("employees");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "department"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase.from("employees").select("*", { count: "exact" })
    .order("full_name", { ascending: true }).range(from, to);
  if (params.q)
    query = query.or(`full_name.ilike.%${params.q}%,code.ilike.%${params.q}%,email.ilike.%${params.q}%,phone.ilike.%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.department) query = query.eq("department", params.filters.department);

  const [{ data, count }, methods, settings] = await Promise.all([
    query,
    getCachedPaymentMethods(),
    getSettings(),
  ]);

  return (
    <EmployeesClient
      employees={(data as Employee[]) || []}
      totalCount={count || 0}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
