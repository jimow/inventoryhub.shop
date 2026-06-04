import { getTenantOverview } from "@/lib/platform";
import { TenantsClient } from "./tenants-client";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const tenants = await getTenantOverview();
  return <TenantsClient tenants={tenants} />;
}
