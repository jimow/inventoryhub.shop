import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/auth";

/**
 * Record one entry in the system activity log. Captures the current user, the
 * module, a human summary and the amount. Fire-and-forget: it never throws, so
 * a logging failure can't break the underlying transaction. tenant_id is set by
 * the column default (current_tenant_id() from the request header).
 */
export async function logActivity(entry: {
  module: string;
  action: string;
  summary?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  amount?: number | null;
}): Promise<void> {
  try {
    let user_id: string | null = null;
    let user_name: string | null = null;
    try {
      const s = await getCurrentSession();
      user_id = s.userId;
      user_name = s.profile.full_name || s.profile.username || s.profile.email || null;
    } catch {
      // No session (e.g. background) — log without a user.
    }
    const admin = createServiceClient();
    await admin.from("activity_log").insert({
      module: entry.module,
      action: entry.action,
      summary: entry.summary ?? null,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      amount: entry.amount ?? null,
      user_id,
      user_name,
    });
  } catch {
    // Swallow — auditing must never break the real work.
  }
}
