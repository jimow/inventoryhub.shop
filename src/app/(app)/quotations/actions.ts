"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { objectsToCsv } from "@/lib/csv";
import { computeLineTotals } from "@/lib/utils";
import type { QuotationLine, QuotationStatus } from "@/lib/types";

type Result = { ok: boolean; error?: string; sale_id?: string };

/** Statuses that still allow editing the quote (not yet converted to a sale). */
const EDITABLE: QuotationStatus[] = ["draft", "sent", "accepted", "rejected", "expired"];

function readForm(formData: FormData, inclusive: boolean, settingsRate: number) {
  const itemsRaw = String(formData.get("items") || "[]");
  let items: QuotationLine[] = [];
  try { items = JSON.parse(itemsRaw); } catch {}
  const discount = Number(formData.get("discount") || 0);
  // VAT rate is taken from Settings (single source of truth); the per-item
  // `taxable` flag decides which lines it applies to.
  const tax_rate = Number(settingsRate) || 0;
  const { subtotal, tax, total } = computeLineTotals(items, discount, tax_rate, inclusive);
  return {
    quote_no: String(formData.get("quote_no") || "").trim(),
    date: String(formData.get("date") || new Date().toISOString().slice(0, 10)),
    valid_until: String(formData.get("valid_until") || "") || null,
    customer_id: String(formData.get("customer_id") || "") || null,
    items, subtotal, discount, tax_rate, tax, total,
    notes: String(formData.get("notes") || "") || null,
  };
}

export async function createQuotation(formData: FormData): Promise<Result> {
  try {
    await requirePermission("quotations", "create");
    const cfg = await getSettings();
    const payload = readForm(formData, !!cfg.tax?.inclusive, Number(cfg.tax?.defaultRate || 0));
    if (!payload.customer_id) return { ok: false, error: "Customer required" };
    if (!payload.items.length) return { ok: false, error: "Add at least one line" };
    if (!payload.quote_no) payload.quote_no = await reserveNextNumber("nextQuotation", cfg.numbering?.quotePrefix || "QT-");

    const supabase = await createClient();
    const { error } = await supabase.from("quotations").insert({ ...payload, status: "draft" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/quotations");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function updateQuotation(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("quotations", "edit");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("quotations").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Quotation not found" };
    if (existing.status === "converted") return { ok: false, error: "A converted quotation can't be edited" };
    const cfg = await getSettings();
    const payload = readForm(formData, !!cfg.tax?.inclusive, Number(cfg.tax?.defaultRate || 0));
    if (!payload.items.length) return { ok: false, error: "Add at least one line" };
    // Don't overwrite the original quote number on edit.
    const { quote_no: _ignore, ...rest } = payload;
    void _ignore;
    const { error } = await supabase.from("quotations").update(rest).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/quotations");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Move a quote through its lifecycle (sent / accepted / rejected / expired). */
export async function setQuotationStatus(id: string, status: QuotationStatus): Promise<Result> {
  try {
    await requirePermission("quotations", "edit");
    if (!EDITABLE.includes(status)) return { ok: false, error: "Invalid status" };
    const supabase = await createClient();
    const { data: existing } = await supabase.from("quotations").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Quotation not found" };
    if (existing.status === "converted") return { ok: false, error: "A converted quotation is locked" };
    const { error } = await supabase.from("quotations").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/quotations");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deleteQuotation(id: string): Promise<Result> {
  try {
    await requirePermission("quotations", "delete");
    const supabase = await createClient();
    const { error } = await supabase.from("quotations").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/quotations");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Convert an accepted quote into a DRAFT sale (invoice type). The quote's lines
 * and totals carry straight over; the new sale then follows the normal sale
 * flow (confirm → stock + journal). The quote is marked `converted` and linked.
 * Requires permission to create sales as well as edit quotations.
 */
export async function convertQuotationToSale(id: string): Promise<Result> {
  try {
    await requirePermission("quotations", "edit");
    await requirePermission("sales", "create");
    const supabase = await createClient();
    const { data: q } = await supabase.from("quotations").select("*").eq("id", id).single();
    if (!q) return { ok: false, error: "Quotation not found" };
    if (q.status === "converted") return { ok: false, error: "Already converted to a sale" };
    if (!q.customer_id) return { ok: false, error: "Quote has no customer" };
    if (!Array.isArray(q.items) || q.items.length === 0) return { ok: false, error: "Quote has no lines" };

    const cfg = await getSettings();
    const invoice_no = await reserveNextNumber("nextInvoice", cfg.numbering?.invoicePrefix || "INV-");
    const { userId } = await getCurrentSession();

    const { data: sale, error: saleErr } = await supabase.from("sales").insert({
      invoice_no,
      date: new Date().toISOString().slice(0, 10),
      customer_id: q.customer_id,
      items: q.items,
      subtotal: q.subtotal,
      discount: q.discount,
      tax_rate: q.tax_rate,
      tax: q.tax,
      total: q.total,
      status: "draft",
      sale_type: "invoice",
      due_date: q.valid_until,
      notes: q.notes ? `From quote ${q.quote_no}: ${q.notes}` : `From quote ${q.quote_no}`,
      created_by: userId,
    }).select("id").single();
    if (saleErr || !sale) return { ok: false, error: saleErr?.message || "Could not create sale" };

    const { error: upErr } = await supabase.from("quotations")
      .update({ status: "converted", converted_sale_id: sale.id }).eq("id", id);
    if (upErr) return { ok: false, error: upErr.message };

    revalidatePath("/quotations");
    revalidatePath("/sales");
    return { ok: true, sale_id: sale.id };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function exportQuotations(
  q?: string, status?: string, customer_id?: string, from?: string, to?: string,
) {
  try {
    await requirePermission("quotations", "view");
    const supabase = await createClient();
    let query = supabase.from("quotations").select("*, customers(name)").order("date", { ascending: false });
    if (q) query = query.ilike("quote_no", `%${q}%`);
    if (status) query = query.eq("status", status);
    if (customer_id) query = query.eq("customer_id", customer_id);
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const csv = objectsToCsv((data as Array<Record<string, unknown> & { customers: { name: string } | null }>) || [], [
      { key: "quote_no", header: "Quote" },
      { key: "date", header: "Date" },
      { key: "valid_until", header: "Valid Until" },
      { key: "customer", header: "Customer", map: (r) => (r.customers as { name?: string } | null)?.name || "" },
      { key: "subtotal", header: "Subtotal" },
      { key: "discount", header: "Discount" },
      { key: "tax", header: "Tax" },
      { key: "total", header: "Total" },
      { key: "status", header: "Status" },
    ]);
    return { ok: true, csv, filename: `quotations-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
