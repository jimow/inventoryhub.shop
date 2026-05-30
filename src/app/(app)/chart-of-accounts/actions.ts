"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import type { AccountType } from "@/lib/types";

type Result = { ok: boolean; error?: string };

function readPayload(fd: FormData) {
  return {
    code: String(fd.get("code") || "").trim(),
    name: String(fd.get("name") || "").trim(),
    type: (String(fd.get("type") || "asset") as AccountType),
    parent_id: String(fd.get("parent_id") || "") || null,
    description: String(fd.get("description") || "") || null,
    is_active: fd.get("is_active") === "on" || fd.get("is_active") === "true",
  };
}

export async function createAccount(fd: FormData): Promise<Result> {
  try {
    await requirePermission("accounting", "create");
    const payload = readPayload(fd);
    if (!payload.code || !payload.name) return { ok: false, error: "Code and name required" };
    const supabase = await createClient();
    const { error } = await supabase.from("accounts").insert(payload);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/chart-of-accounts");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function updateAccount(id: string, fd: FormData): Promise<Result> {
  try {
    await requirePermission("accounting", "edit");
    const payload = readPayload(fd);
    if (!payload.code || !payload.name) return { ok: false, error: "Code and name required" };
    const supabase = await createClient();
    const { error } = await supabase.from("accounts").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/chart-of-accounts");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deleteAccount(id: string): Promise<Result> {
  try {
    await requirePermission("accounting", "delete");
    const supabase = await createClient();
    const { data: a } = await supabase.from("accounts").select("is_system").eq("id", id).single();
    if (a?.is_system) return { ok: false, error: "System accounts cannot be deleted" };
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/chart-of-accounts");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
