import { createPlatformClient, getTenantOverview } from "@/lib/platform";
import { ServersClient, type ServerRow, type DeploymentRow } from "./servers-client";

export const dynamic = "force-dynamic";

type SP = Promise<{ deploy?: string }>;

export default async function ServersPage({ searchParams }: { searchParams: SP }) {
  const sp = (await searchParams) ?? {};
  const admin = createPlatformClient();

  const [{ data: servers }, { data: deployments }, tenants] = await Promise.all([
    admin.from("platform_servers").select("id, name, host, port, ssh_user, auth_method, app_dir, repo_url, branch, app_port, base_url, status, last_checked, last_result").order("created_at"),
    admin.from("platform_deployments").select("id, server_name, tenant_name, status, app_port, base_url, started_at, finished_at").order("started_at", { ascending: false }).limit(20),
    getTenantOverview(),
  ]);

  return (
    <ServersClient
      servers={(servers as ServerRow[]) || []}
      deployments={(deployments as DeploymentRow[]) || []}
      tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
      deployTenantId={sp.deploy || null}
    />
  );
}
