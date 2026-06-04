import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { ActivityLogClient, type ActivityRow } from "./activity-client";

export const dynamic = "force-dynamic";

type SP = Promise<{ from?: string; to?: string; module?: string; user?: string }>;

export default async function ActivityLogPage({ searchParams }: { searchParams: SP }) {
  await requireViewPermission("audit");
  const sp = (await searchParams) ?? {};
  const admin = createServiceClient();
  const tid = currentTenantId();

  let q = admin.from("activity_log").select("*").order("created_at", { ascending: false }).limit(1000);
  if (tid) q = q.eq("tenant_id", tid);
  if (sp.from) q = q.gte("created_at", `${sp.from}T00:00:00`);
  if (sp.to) q = q.lte("created_at", `${sp.to}T23:59:59.999`);
  if (sp.module) q = q.eq("module", sp.module);
  if (sp.user) q = q.eq("user_id", sp.user);

  // Users for the filter dropdown (this tenant's profiles).
  let pq = admin.from("profiles").select("id, full_name, username, email").order("full_name");
  if (tid) pq = pq.eq("tenant_id", tid);

  const [{ data: rows }, { data: profiles }, settings] = await Promise.all([q, pq, getSettings()]);

  const users = (profiles || []).map((p) => ({
    id: p.id as string,
    name: (p.full_name || p.username || p.email || "user") as string,
  }));

  return (
    <ActivityLogClient
      rows={(rows as ActivityRow[]) || []}
      users={users}
      settings={settings}
      filters={{ from: sp.from || "", to: sp.to || "", module: sp.module || "", user: sp.user || "" }}
    />
  );
}
