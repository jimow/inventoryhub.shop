import { getTenantOverview } from "@/lib/platform";
import { TestsClient } from "./tests-client";

export const dynamic = "force-dynamic";

export default async function PlatformTestsPage() {
  const tenants = await getTenantOverview();
  return <TestsClient tenants={tenants.map((t) => ({ id: t.id, name: t.name }))} />;
}
