"use server";

import { revalidatePath } from "next/cache";
import { createPlatformClient, getPlatformSession, logPlatformAction } from "@/lib/platform";

export type ActionResult = { ok: boolean; error?: string };

/** Confirm a profile belongs to the given tenant (prevents cross-tenant edits). */
async function assertInTenant(
  admin: ReturnType<typeof createPlatformClient>,
  tenantId: string,
  userId: string
): Promise<{ email: string | null } | null> {
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ? { email: (data.email as string) ?? null } : null;
}

/** Activate / deactivate a workspace user. */
export async function setTenantUserStatus(
  tenantId: string,
  userId: string,
  status: "active" | "inactive"
): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const admin = createPlatformClient();
  const who = await assertInTenant(admin, tenantId, userId);
  if (!who) return { ok: false, error: "User is not part of this workspace." };

  const { error } = await admin.from("profiles").update({ status }).eq("id", userId).eq("tenant_id", tenantId);
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({ action: `user.${status}`, tenantId, detail: { userId, email: who.email } });
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true };
}

/** Set a new password for a workspace user. */
export async function resetTenantUserPassword(
  tenantId: string,
  userId: string,
  newPassword: string
): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const admin = createPlatformClient();
  const who = await assertInTenant(admin, tenantId, userId);
  if (!who) return { ok: false, error: "User is not part of this workspace." };

  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({ action: "user.password_reset", tenantId, detail: { userId, email: who.email } });
  return { ok: true };
}

/** Change a workspace user's role. */
export async function changeTenantUserRole(
  tenantId: string,
  userId: string,
  roleId: string
): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const admin = createPlatformClient();
  const who = await assertInTenant(admin, tenantId, userId);
  if (!who) return { ok: false, error: "User is not part of this workspace." };

  // The role must belong to the same tenant.
  const { data: role } = await admin
    .from("roles").select("id, name").eq("id", roleId).eq("tenant_id", tenantId).maybeSingle();
  if (!role) return { ok: false, error: "Role not found in this workspace." };

  const { error } = await admin.from("profiles").update({ role_id: roleId }).eq("id", userId).eq("tenant_id", tenantId);
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({ action: "user.role_changed", tenantId, detail: { userId, email: who.email, role: role.name } });
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true };
}
