import { createPlatformClient, getPlatformSession } from "@/lib/platform";
import { AdminsClient, type AdminRow } from "./admins-client";

export const dynamic = "force-dynamic";

export default async function PlatformAdminsPage() {
  const admin = createPlatformClient();
  const session = await getPlatformSession();
  const { data } = await admin
    .from("platform_admins")
    .select("id, email, name, created_at")
    .order("created_at");

  return <AdminsClient admins={(data as AdminRow[]) || []} currentUserId={session?.userId || ""} />;
}
