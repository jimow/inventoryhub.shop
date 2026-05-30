"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { objectsToCsv } from "@/lib/csv";

type Result = { ok: boolean; error?: string };

export async function createUser(formData: FormData): Promise<Result> {
  try {
    await requirePermission("users", "create");
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const fullName = String(formData.get("full_name") || "");
    const username = String(formData.get("username") || "") || email.split("@")[0];
    const roleId = String(formData.get("role_id") || "");
    const status = String(formData.get("status") || "active");

    if (!email || !password) return { ok: false, error: "Email and password required" };

    const admin = createServiceClient();
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username },
    });
    if (authErr || !created.user) return { ok: false, error: authErr?.message || "Failed to create auth user" };

    await admin.from("profiles").update({
      username, full_name: fullName, email, role_id: roleId || null, status,
    }).eq("id", created.user.id);

    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateUser(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("users", "edit");
    const username = String(formData.get("username") || "");
    const fullName = String(formData.get("full_name") || "");
    const email = String(formData.get("email") || "");
    const roleId = String(formData.get("role_id") || "");
    const status = String(formData.get("status") || "active");
    const password = String(formData.get("password") || "");

    const admin = createServiceClient();
    const { error } = await admin.from("profiles").update({
      username, full_name: fullName, email, role_id: roleId || null, status,
    }).eq("id", id);
    if (error) return { ok: false, error: error.message };

    if (password) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(id, { password });
      if (pwErr) return { ok: false, error: pwErr.message };
    }

    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteUser(id: string): Promise<Result> {
  try {
    await requirePermission("users", "delete");
    const { userId } = await getCurrentSession();
    if (id === userId) return { ok: false, error: "You can't delete your own account" };
    const admin = createServiceClient();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkDeleteUsers(ids: string[]) {
  try {
    await requirePermission("users", "delete");
    const { userId } = await getCurrentSession();
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const admin = createServiceClient();
    let deleted = 0, skipped = 0;
    for (const id of ids) {
      if (id === userId) { skipped++; continue; }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (!error) deleted++;
    }
    revalidatePath("/users");
    const note = skipped ? ` (your own account skipped)` : "";
    return { ok: true, message: `${deleted} user(s) deleted${note}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkSetUserStatus(ids: string[], status: "active" | "inactive") {
  try {
    await requirePermission("users", "edit");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const admin = createServiceClient();
    const { error } = await admin.from("profiles").update({ status }).in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/users");
    return { ok: true, message: `${ids.length} user(s) set ${status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function exportUsers(q?: string, status?: string, role_id?: string) {
  try {
    await requirePermission("users", "view");
    const admin = createServiceClient();
    let query = admin.from("profiles").select("*, roles(name)").order("created_at", { ascending: false });
    if (q) query = query.or(`username.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%`);
    if (status) query = query.eq("status", status);
    if (role_id) query = query.eq("role_id", role_id);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const csv = objectsToCsv((data as Array<Record<string, unknown> & { roles: { name: string } | null }>) || [], [
      { key: "username", header: "Username" },
      { key: "full_name", header: "Full Name" },
      { key: "email", header: "Email" },
      { key: "role", header: "Role", map: (r) => (r.roles as { name?: string } | null)?.name || "" },
      { key: "status", header: "Status" },
      { key: "created_at", header: "Created At" },
    ]);
    return { ok: true, csv, filename: `users-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
