// Server-only. Enforces the platform-set lifecycle status of THIS deployment's
// tenant (active | read_only | suspended | locked). Read once per request and
// consulted by the (app) layout (blocks suspended/locked) and requirePermission
// (blocks all mutations when read_only/suspended/locked).

import { cache } from "react";
import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import type { TenantStatus } from "@/lib/platform-shared";

export type ActiveTenantStatus = {
  status: TenantStatus;
  reason: string | null;
  name: string | null;
};

const ACTIVE: ActiveTenantStatus = { status: "active", reason: null, name: null };

/** The current deployment tenant's lifecycle status. Defaults to active on any error. */
export const getActiveTenantStatus = cache(async function _getActiveTenantStatus(): Promise<ActiveTenantStatus> {
  const tid = currentTenantId();
  if (!tid) return ACTIVE;
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("tenants")
      .select("status, status_reason, name")
      .eq("id", tid)
      .maybeSingle();
    if (!data) return ACTIVE;
    return {
      status: (data.status as TenantStatus) || "active",
      reason: (data.status_reason as string) ?? null,
      name: (data.name as string) ?? null,
    };
  } catch {
    return ACTIVE;
  }
});
