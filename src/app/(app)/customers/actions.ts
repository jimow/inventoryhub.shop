"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { postOpeningBalanceJournal } from "@/lib/accounting";
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
    credit_limit: Number(formData.get("credit_limit") || 0),
    status: String(formData.get("status") || "active"),
  };
}

export async function createCustomer(formData: FormData): Promise<Result> {
  try {
    await requirePermission("customers", "create");
    const cfg = await getSettings();
    const payload = readPayload(formData);
    if (!payload.code) payload.code = await reserveNextNumber("nextCustomer", cfg.numbering?.customerPrefix || "CUST-");
    if (!payload.name) return { ok: false, error: "Name is required" };

    // Opening balance: what the customer already owes us when first entered.
    const opening = Math.max(0, Number(formData.get("opening_balance") || 0) || 0);
    const openingDate = String(formData.get("opening_date") || "") || new Date().toISOString().slice(0, 10);

    const supabase = await createClient();
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        ...payload,
        opening_balance: opening,
        opening_date: opening > 0 ? openingDate : null,
        balance: opening, // seed cached balance; recompute keeps it in sync
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: error?.message || "Failed to create customer" };

    if (opening > 0) {
      const j = await postOpeningBalanceJournal({
        party: "customer", partyId: created.id as string, name: payload.name,
        amount: opening, date: openingDate,
      });
      if (!j.ok) return { ok: false, error: `Customer saved, but opening-balance journal failed: ${j.error}` };
    }

    revalidatePath("/customers");
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateCustomer(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("customers", "edit");
    const payload = readPayload(formData);
    if (!payload.name || !payload.code) return { ok: false, error: "Code and name required" };
    const supabase = await createClient();
    const { error } = await supabase.from("customers").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteCustomer(id: string): Promise<Result> {
  try {
    await requirePermission("customers", "delete");
    const supabase = await createClient();
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkDeleteCustomers(ids: string[]) {
  try {
    await requirePermission("customers", "delete");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const supabase = await createClient();
    const { error } = await supabase.from("customers").delete().in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/customers");
    return { ok: true, message: `${ids.length} customer(s) deleted` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkSetCustomerStatus(ids: string[], status: "active" | "inactive") {
  try {
    await requirePermission("customers", "edit");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const supabase = await createClient();
    const { error } = await supabase.from("customers").update({ status }).in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/customers");
    return { ok: true, message: `${ids.length} customer(s) set ${status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function importCustomers(rows: Record<string, string>[]) {
  try {
    await requirePermission("customers", "create");
    const supabase = await createClient();
    const cfg = await getSettings();
    const records = [];
    for (const row of rows) {
      const get = (k: string) => row[k] ?? row[k.toLowerCase()] ?? "";
      const name = String(get("Name")).trim();
      if (!name) continue;
      let code = String(get("Code")).trim();
      if (!code) code = await reserveNextNumber("nextCustomer", cfg.numbering?.customerPrefix || "CUST-");
      records.push({
        code, name,
        email: String(get("Email")) || null,
        phone: String(get("Phone")) || null,
        address: String(get("Address")) || null,
        city: String(get("City")) || null,
        country: String(get("Country")) || null,
        tax_id: String(get("Tax ID")) || null,
        credit_limit: Number(get("Credit Limit") || 0),
        status: String(get("Status")).toLowerCase() === "inactive" ? "inactive" : "active",
      });
    }
    if (!records.length) return { ok: false, error: "No valid rows" };
    const { error, count } = await supabase.from("customers").insert(records, { count: "exact" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/customers");
    return { ok: true, inserted: count ?? records.length, failed: rows.length - records.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function exportCustomers(q?: string, status?: string) {
  try {
    await requirePermission("customers", "view");
    const supabase = await createClient();
    let query = supabase.from("customers").select("*").order("created_at", { ascending: false });
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
      { key: "credit_limit", header: "Credit Limit" },
      { key: "status", header: "Status" },
    ]);
    return { ok: true, csv, filename: `customers-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
