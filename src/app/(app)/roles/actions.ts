"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import type { PermissionMatrix } from "@/lib/permissions";

type Result = { ok: boolean; error?: string };

export async function createRole(formData: FormData): Promise<Result> {
  try {
    await requirePermission("roles", "create");
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "");
    const permissionsRaw = String(formData.get("permissions") || "{}");
    let perms: PermissionMatrix = {};
    try { perms = JSON.parse(permissionsRaw); } catch {}
    if (!name) return { ok: false, error: "Role name required" };
    const supabase = await createClient();
    const { error } = await supabase.from("roles").insert({ name, description, permissions: perms });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateRole(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("roles", "edit");
    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "");
    const permissionsRaw = String(formData.get("permissions") || "{}");
    let perms: PermissionMatrix = {};
    try { perms = JSON.parse(permissionsRaw); } catch {}
    if (!name) return { ok: false, error: "Role name required" };
    const supabase = await createClient();
    const { error } = await supabase
      .from("roles")
      .update({ name, description, permissions: perms })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteRole(id: string): Promise<Result> {
  try {
    await requirePermission("roles", "delete");
    const supabase = await createClient();
    // Check if any users have this role
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role_id", id);
    if ((count || 0) > 0) return { ok: false, error: "Role is in use by users" };
    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
