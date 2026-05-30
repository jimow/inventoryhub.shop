import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient, createServiceClient, currentTenantId } from "@/lib/supabase/server";
import type { SettingsData } from "./types";

/**
 * Reserve the next document number from settings.numbering and bump the counter.
 * Returns the formatted document number, e.g. "INV-00007".
 */
export async function reserveNextNumber(
  field: keyof SettingsData["numbering"],
  prefix: string
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("data")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error("Settings not found");
  const settings = data.data as SettingsData;
  const current = Number((settings.numbering as unknown as Record<string, number>)[field] ?? 1);
  const next = `${prefix}${String(current).padStart(5, "0")}`;

  const updated: SettingsData = {
    ...settings,
    numbering: {
      ...settings.numbering,
      [field]: current + 1,
    } as SettingsData["numbering"],
  };
  await supabase.from("settings").update({ data: updated }).eq("id", 1);
  return next;
}

// Cross-request cache (survives between navigations). 60 s TTL; invalidated
// by the settings update action via revalidateTag("app-settings").
const _settingsFromDB = unstable_cache(
  async () => {
    const admin = createServiceClient();
    // Service role bypasses RLS, so scope to this tenant explicitly when in
    // shared-tenancy mode; otherwise fall back to the legacy singleton row.
    const tid = currentTenantId();
    const q = admin.from("settings").select("data");
    const { data } = tid
      ? await q.eq("tenant_id", tid).maybeSingle()
      : await q.eq("id", 1).maybeSingle();
    return (data?.data as SettingsData) || ({} as SettingsData);
  },
  ["app-settings"],
  { revalidate: 60, tags: ["app-settings"] }
);

// React cache() deduplicates within a single render pass on top of the
// unstable_cache cross-request layer.
export const getSettings = cache(async function _getSettings(): Promise<SettingsData> {
  return _settingsFromDB();
});
