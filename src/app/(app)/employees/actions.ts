"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import type { CommissionBasis, EmployeeStatus } from "@/lib/types";

type Result = { ok: boolean; error?: string };

function read(formData: FormData) {
  const num = (k: string) => {
    const n = Number(formData.get(k));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    code:             String(formData.get("code") || "").trim(),
    full_name:        String(formData.get("full_name") || "").trim(),
    email:            String(formData.get("email") || "") || null,
    phone:            String(formData.get("phone") || "") || null,
    national_id:      String(formData.get("national_id") || "") || null,
    department:       String(formData.get("department") || "") || null,
    position:         String(formData.get("position") || "") || null,
    hire_date:        String(formData.get("hire_date") || new Date().toISOString().slice(0, 10)),
    termination_date: (String(formData.get("termination_date") || "") || null) as string | null,
    base_salary:      num("base_salary"),
    commission_rate:  num("commission_rate"),
    commission_basis: (String(formData.get("commission_basis") || "manual") as CommissionBasis),
    payment_method_id: (String(formData.get("payment_method_id") || "") || null) as string | null,
    bank_account_no:  String(formData.get("bank_account_no") || "") || null,
    status:           (String(formData.get("status") || "active") as EmployeeStatus),
    notes:            String(formData.get("notes") || "") || null,
  };
}

export async function createEmployee(formData: FormData): Promise<Result> {
  try {
    await requirePermission("employees", "create");
    const cfg = await getSettings();
    const payload = read(formData);
    if (!payload.full_name) return { ok: false, error: "Full name is required" };
    if (!payload.code) {
      // Reuse the customer prefix counter pattern but with a dedicated prefix.
      const next = await reserveNextNumber("nextCustomer", "EMP-");
      payload.code = next;
    }
    // Settings shape compat — if numbering counter exists, use it instead.
    void cfg;
    const supabase = await createClient();
    const { error } = await supabase.from("employees").insert(payload);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/employees");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateEmployee(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("employees", "edit");
    const payload = read(formData);
    if (!payload.full_name) return { ok: false, error: "Full name is required" };
    const supabase = await createClient();
    const { error } = await supabase.from("employees").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/employees");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteEmployee(id: string): Promise<Result> {
  try {
    await requirePermission("employees", "delete");
    const supabase = await createClient();
    // Block delete if employee has salary payments — soft-archive instead.
    const { count } = await supabase
      .from("salary_payments").select("id", { count: "exact", head: true })
      .eq("employee_id", id);
    if ((count ?? 0) > 0) {
      const { error } = await supabase
        .from("employees")
        .update({ status: "terminated", termination_date: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/employees");
      return { ok: true };
    }
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/employees");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
