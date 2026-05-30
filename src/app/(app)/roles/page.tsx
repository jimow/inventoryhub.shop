import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { RolesClient } from "./roles-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Role, Profile } from "@/lib/types";

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("roles");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, []);
  const { from, to } = listRange(params);

  const admin = createServiceClient();
  const tid = currentTenantId();
  let query = admin.from("roles").select("*", { count: "exact" }).order("name").range(from, to);
  if (tid) query = query.eq("tenant_id", tid);
  if (params.q) query = query.or(`name.ilike.%${params.q}%,description.ilike.%${params.q}%`);

  let usersQuery = admin.from("profiles").select("id,role_id");
  if (tid) usersQuery = usersQuery.eq("tenant_id", tid);

  const [{ data: roles, count }, { data: users }] = await Promise.all([
    query,
    usersQuery,
  ]);
  return (
    <RolesClient
      roles={(roles as Role[]) || []}
      totalCount={count || 0}
      users={(users as Profile[]) || []}
      permissions={permissions}
    />
  );
}
