"use server";

import { revalidatePath } from "next/cache";
import {
  createPlatformClient,
  getPlatformSession,
  logPlatformAction,
} from "@/lib/platform";

export type ActionResult = { ok: boolean; error?: string };

type AdminClient = ReturnType<typeof createPlatformClient>;

/** Find an existing auth user id by email (paginates the admin user list). */
async function findUserIdByEmail(admin: AdminClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Promote an existing login, or create a new super-admin account. */
export async function addPlatformAdmin(formData: FormData): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email) return { ok: false, error: "Email is required." };

  const admin = createPlatformClient();

  let userId: string | null = null;

  // Try to create a fresh account first.
  if (password) {
    if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : undefined,
    });
    if (created.data?.user) userId = created.data.user.id;
    else if (created.error && !/already|registered|exists/i.test(created.error.message || "")) {
      return { ok: false, error: created.error.message };
    }
  }

  // Fall back to an existing account.
  if (!userId) {
    userId = await findUserIdByEmail(admin, email);
    if (!userId) {
      return {
        ok: false,
        error: "No account exists for this email. Provide a password to create a new super-admin account.",
      };
    }
  }

  const { error } = await admin.from("platform_admins").upsert(
    { id: userId, email, name: name || null, created_by: session.userId },
    { onConflict: "id" }
  );
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({ action: "admin.added", detail: { email, name } });
  revalidatePath("/platform/admins");
  return { ok: true };
}

/** Revoke a platform admin. Refuses to remove the last remaining admin. */
export async function removePlatformAdmin(userId: string): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const admin = createPlatformClient();
  const { count } = await admin.from("platform_admins").select("*", { count: "exact", head: true });
  if ((count ?? 0) <= 1) return { ok: false, error: "You cannot remove the last platform administrator." };

  const { data: target } = await admin.from("platform_admins").select("email").eq("id", userId).maybeSingle();
  const { error } = await admin.from("platform_admins").delete().eq("id", userId);
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({ action: "admin.removed", detail: { email: target?.email ?? null, userId } });
  revalidatePath("/platform/admins");
  return { ok: true };
}
