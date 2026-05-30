import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { UsersClient } from "./users-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Profile, Role } from "@/lib/types";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("users");
  const { permissions, userId } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "role_id"]);
  const { from, to } = listRange(params);

  const admin = createServiceClient();
  const tid = currentTenantId();
  let query = admin.from("profiles").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (tid) query = query.eq("tenant_id", tid);
  if (params.q) query = query.or(`username.ilike.%${params.q}%,full_name.ilike.%${params.q}%,email.ilike.%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.role_id) query = query.eq("role_id", params.filters.role_id);

  let rolesQuery = admin.from("roles").select("*").order("name");
  if (tid) rolesQuery = rolesQuery.eq("tenant_id", tid);

  const [{ data: users, count }, { data: roles }] = await Promise.all([
    query,
    rolesQuery,
  ]);
  const rolesArr = (roles as Role[]) || [];
  const enriched = ((users as Profile[]) || []).map((u) => ({
    ...u,
    role_name: rolesArr.find((r) => r.id === u.role_id)?.name ?? null,
  }));

  return (
    <UsersClient
      users={enriched}
      totalCount={count || 0}
      roles={rolesArr}
      permissions={permissions}
      currentUserId={userId}
    />
  );
}
