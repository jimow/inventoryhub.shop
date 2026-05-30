"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { objectsToCsv } from "@/lib/csv";

type Result = { ok: boolean; error?: string };

function readPayload(formData: FormData) {
  return {
    code: String(formData.get("code") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "") || null,
    phone: String(formData.get("phone") || "") || null,
    address: String(formData.get("address") || "") || null,
    city: String(formData.get("city") || "") || null,
    country: String(formData.get("country") || "") || null,
    tax_id: String(formData.get("tax_id") || "") || null,
    payment_terms: String(formData.get("payment_terms") || "Net 30"),
    status: String(formData.get("status") || "active"),
  };
}

export async function createSupplier(formData: FormData): Promise<Result> {
  try {
    await requirePermission("suppliers", "create");
    const cfg = await getSettings();
    const payload = readPayload(formData);
    if (!payload.code) payload.code = await reserveNextNumber("nextSupplier", cfg.numbering?.supplierPrefix || "SUP-");
    if (!payload.name) return { ok: false, error: "Name is required" };
    const supabase = await createClient();
    const { error } = await supabase.from("suppliers").insert(payload);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateSupplier(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("suppliers", "edit");
    const payload = readPayload(formData);
    if (!payload.name || !payload.code) return { ok: false, error: "Code and name required" };
    const supabase = await createClient();
    const { error } = await supabase.from("suppliers").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteSupplier(id: string): Promise<Result> {
  try {
    await requirePermission("suppliers", "delete");
    const supabase = await createClient();
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkDeleteSuppliers(ids: string[]) {
  try {
    await requirePermission("suppliers", "delete");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const supabase = await createClient();
    const { error } = await supabase.from("suppliers").delete().in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/suppliers");
    return { ok: true, message: `${ids.length} supplier(s) deleted` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkSetSupplierStatus(ids: string[], status: "active" | "inactive") {
  try {
    await requirePermission("suppliers", "edit");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const supabase = await createClient();
    const { error } = await supabase.from("suppliers").update({ status }).in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/suppliers");
    return { ok: true, message: `${ids.length} supplier(s) set ${status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function importSuppliers(rows: Record<string, string>[]) {
  try {
    await requirePermission("suppliers", "create");
    const supabase = await createClient();
    const cfg = await getSettings();
    const records = [];
    for (const row of rows) {
      const get = (k: string) => row[k] ?? row[k.toLowerCase()] ?? "";
      const name = String(get("Name")).trim();
      if (!name) continue;
      let code = String(get("Code")).trim();
      if (!code) code = await reserveNextNumber("nextSupplier", cfg.numbering?.supplierPrefix || "SUP-");
      records.push({
        code, name,
        email: String(get("Email")) || null,
        phone: String(get("Phone")) || null,
        address: String(get("Address")) || null,
        city: String(get("City")) || null,
        country: String(get("Country")) || null,
        tax_id: String(get("Tax ID")) || null,
        payment_terms: String(get("Payment Terms")) || "Net 30",
        status: String(get("Status")).toLowerCase() === "inactive" ? "inactive" : "active",
      });
    }
    if (!records.length) return { ok: false, error: "No valid rows" };
    const { error, count } = await supabase.from("suppliers").insert(records, { count: "exact" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/suppliers");
    return { ok: true, inserted: count ?? records.length, failed: rows.length - records.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function exportSuppliers(q?: string, status?: string) {
  try {
    await requirePermission("suppliers", "view");
    const supabase = await createClient();
    let query = supabase.from("suppliers").select("*").order("created_at", { ascending: false });
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,email.ilike.%${q}%`);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const csv = objectsToCsv(data || [], [
      { key: "code", header: "Code" },
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "phone", header: "Phone" },
      { key: "address", header: "Address" },
      { key: "city", header: "City" },
      { key: "country", header: "Country" },
      { key: "tax_id", header: "Tax ID" },
      { key: "payment_terms", header: "Payment Terms" },
      { key: "status", header: "Status" },
    ]);
    return { ok: true, csv, filename: `suppliers-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
