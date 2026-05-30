import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  await requireViewPermission("settings");
  const { permissions } = await getCurrentSession();
  const settings = await getSettings();
  return <SettingsClient settings={settings} permissions={permissions} />;
}
