"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { objectsToCsv } from "@/lib/csv";
import { postPurchaseJournal, postPaymentJournal, recomputePurchaseStatus, reverseJournalsForSource, availableFunds } from "@/lib/accounting";
import { computeLineTotals } from "@/lib/utils";
import type { PurchaseLine, PurchaseType } from "@/lib/types";

type Result = { ok: boolean; error?: string };

function readForm(formData: FormData, inclusive: boolean) {
  const itemsRaw = String(formData.get("items") || "[]");
  let items: PurchaseLine[] = [];
  try { items = JSON.parse(itemsRaw); } catch {}
  const discount = Number(formData.get("discount") || 0);
  const tax_rate = Number(formData.get("tax_rate") || 0);
  // Honor Settings → Currency & Tax → "Prices are tax-inclusive" so supplier
  // invoice grand totals match what was on their paper.
  const { subtotal, tax, total } = computeLineTotals(items, discount, tax_rate, inclusive);
  const purchase_type = (String(formData.get("purchase_type") || "cash") as PurchaseType);
  const due_date = String(formData.get("due_date") || "") || null;
  return {
    po_no: String(formData.get("po_no") || "").trim(),
    date: String(formData.get("date") || new Date().toISOString().slice(0, 10)),
    supplier_id: String(formData.get("supplier_id") || "") || null,
    items, subtotal, discount, tax_rate, tax, total, purchase_type,
    due_date: purchase_type === "credit" ? due_date : null,
    notes: String(formData.get("notes") || "") || null,
  };
}

export async function createPurchase(formData: FormData): Promise<Result> {
  try {
    await requirePermission("purchases", "create");
    const cfg = await getSettings();
    const payload = readForm(formData, !!cfg.tax?.inclusive);
    if (!payload.po_no) payload.po_no = await reserveNextNumber("nextPO", cfg.numbering?.poPrefix || "PO-");
    if (!payload.supplier_id) return { ok: false, error: "Supplier required" };
    if (!payload.items.length) return { ok: false, error: "Add at least one line" };
    const supabase = await createClient();
    const { error } = await supabase.from("purchases").insert({ ...payload, status: "draft", amount_paid: 0 });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/purchases");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function updatePurchase(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("purchases", "edit");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("purchases").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Purchase not found" };
    if (existing.status !== "draft") return { ok: false, error: "Only draft purchases can be edited" };
    const cfg = await getSettings();
    const payload = readForm(formData, !!cfg.tax?.inclusive);
    if (!payload.items.length) return { ok: false, error: "Add at least one line" };
    const { error } = await supabase.from("purchases").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/purchases");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function markOrdered(id: string): Promise<Result> {
  try {
    await requirePermission("purchases", "edit");
    const supabase = await createClient();
    const { data: po } = await supabase.from("purchases").select("status").eq("id", id).single();
    if (!po) return { ok: false, error: "Not found" };
    if (po.status !== "draft") return { ok: false, error: "Only drafts can be ordered" };
    const { error } = await supabase.from("purchases").update({ status: "ordered" }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/purchases");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Mark a purchase as received. For each line we bump product current_stock.
 * Additionally, if the product is serial_tracked we expect the caller to
 * pass `serialsByLine[lineIdx] = [{ serial, barcode? }, ...]` with exactly
 * `qty` entries - one row is inserted into inventory_units for each unit.
 */
export async function receivePurchase(
  id: string,
  serialsByLine?: Record<number, { serial: string; barcode?: string }[]>,
  paidAmount?: number,
  payment_method_id?: string | null,
): Promise<Result> {
  try {
    await requirePermission("purchases", "edit");
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: po } = await supabase.from("purchases").select("*").eq("id", id).single();
    if (!po) return { ok: false, error: "Not found" };
    if (po.status !== "ordered") return { ok: false, error: "Only ordered purchases can be received" };

    const lines = (po.items as PurchaseLine[]) || [];
    const refIds = Array.from(new Set(lines.map((l) => l.refId)));
    const { data: prods } = await admin
      .from("products")
      .select("id, name, serial_tracked, current_stock")
      .in("id", refIds);
    type Prod = { id: string; name: string; serial_tracked: boolean; current_stock: number };
    const prodMap = new Map<string, Prod>((prods || []).map((p) => [p.id, p as Prod]));

    // Validate every serial-tracked line has the right number of serials.
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const p = prodMap.get(l.refId);
      if (p?.serial_tracked) {
        const serials = serialsByLine?.[i] || [];
        if (serials.length !== Number(l.qty)) {
          return { ok: false, error: `${p.name} requires ${l.qty} serial number(s); got ${serials.length}` };
        }
        if (serials.some((s) => !s.serial?.trim())) {
          return { ok: false, error: `${p.name}: every unit needs a non-blank serial` };
        }
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const p = prodMap.get(l.refId);
      if (!p) continue;
      await admin.from("products")
        .update({ current_stock: Number(p.current_stock) + Number(l.qty) })
        .eq("id", l.refId);

      if (p.serial_tracked) {
        const serials = serialsByLine?.[i] || [];
        const rows = serials.map((s) => ({
          product_id:        l.refId,
          serial_no:         s.serial.trim(),
          barcode:           s.barcode?.trim() || null,
          status:            "in_stock",
          cost:              Number(l.price) || 0,
          purchase_id:       po.id,
          purchase_line_idx: i,
        }));
        if (rows.length) {
          const { error: insErr } = await admin.from("inventory_units").insert(rows);
          if (insErr) return { ok: false, error: `Failed to record serials: ${insErr.message}` };
        }
      }
    }

    // Move PO into received state first so the journal looks right.
    const { data: rec } = await supabase
      .from("purchases")
      .update({ status: "received", amount_paid: 0 })
      .eq("id", id)
      .select("*")
      .single();
    const purchase = rec ?? { ...po, status: "received", amount_paid: 0 };

    // 1) Always post the inventory journal: Dr Inventory / Cr AP / (Dr Tax)
    await postPurchaseJournal(purchase);

    // 2) For CASH purchases, auto-create a Payment via the default Cash method
    //    so AP is cleared (Dr AP / Cr Cash). Without this the books stay
    //    out of balance because AP would never be relieved.
    if (po.purchase_type === "cash") {
      // Pay from the chosen account (payment method), or fall back to the
      // default Cash method.
      let cashPm: { id: string } | null = null;
      if (payment_method_id) {
        const { data } = await admin.from("payment_methods")
          .select("id").eq("id", payment_method_id).eq("is_active", true).maybeSingle();
        cashPm = data ?? null;
      }
      if (!cashPm) {
        const { data } = await admin.from("payment_methods")
          .select("id").eq("kind", "cash").eq("is_active", true)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        cashPm = data ?? null;
      }

      const total = Number(po.total);
      // Partial payment: pay `paidAmount` now (defaults to full); the rest
      // stays as an AP balance to the supplier. The purchase journal already
      // booked full AP, so a partial payment naturally leaves the balance.
      let payAmt = paidAmount != null && Number.isFinite(paidAmount)
        ? Math.max(0, Math.min(paidAmount, total))
        : total;

      // Don't pay what you don't have: cap to available cash. Any shortfall
      // simply remains as a balance owed to the supplier (AP).
      if (cashPm && payAmt > 0) {
        const avail = await availableFunds(cashPm.id);
        if (payAmt > avail) payAmt = Math.max(0, Math.round(avail * 100) / 100);
      }

      if (cashPm && payAmt > 0) {
        const payment_no = await reserveNextNumber("nextPayment", "PMT-");
        const { data: payment } = await admin
          .from("payments")
          .insert({
            payment_no,
            date: new Date().toISOString().slice(0, 10),
            direction: "out",
            source_type: "purchase",
            purchase_id: po.id,
            supplier_id: po.supplier_id,
            payment_method_id: cashPm.id,
            amount: payAmt,
            notes: payAmt < total
              ? `Partial cash payment for PO ${po.po_no} (balance ${(total - payAmt).toFixed(2)})`
              : `Cash payment for PO ${po.po_no}`,
          })
          .select("*")
          .single();
        if (payment) {
          await postPaymentJournal(payment);
          await recomputePurchaseStatus(po.id);
        }
      } else if (!cashPm && payAmt > 0) {
        // No cash payment method seeded — fall back to legacy "paid" flag so
        // the user knows the cash didn't move; they can reconcile manually.
        await supabase.from("purchases")
          .update({ status: "paid", amount_paid: payAmt })
          .eq("id", id);
      }
    }

    revalidatePath("/purchases");
    revalidatePath("/payments");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Manually record a payment against a credit purchase. Creates the Payment
 * row + posts its journal (Dr AP / Cr cash-or-bank).
 */
export async function recordPurchasePayment(
  id: string,
  amount: number,
  payment_method_id?: string | null,
  reference?: string | null,
): Promise<Result> {
  try {
    await requirePermission("purchases", "edit");
    if (!amount || amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: po } = await supabase.from("purchases").select("*").eq("id", id).single();
    if (!po) return { ok: false, error: "Not found" };
    if (po.status !== "received") return { ok: false, error: "Only received (unpaid) purchases accept payments" };
    const newPaid = Number(po.amount_paid || 0) + Number(amount);
    if (newPaid > Number(po.total) + 0.001) return { ok: false, error: "Payment exceeds outstanding balance" };

    // Resolve payment method (caller-supplied or first active cash method).
    let pmId = payment_method_id ?? null;
    if (!pmId) {
      const { data: cashPm } = await admin
        .from("payment_methods")
        .select("id")
        .eq("kind", "cash")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      pmId = cashPm?.id ?? null;
    }

    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const { data: payment } = await admin
      .from("payments")
      .insert({
        payment_no,
        date: new Date().toISOString().slice(0, 10),
        direction: "out",
        source_type: "purchase",
        purchase_id: id,
        supplier_id: po.supplier_id,
        payment_method_id: pmId,
        amount: Number(amount),
        reference: reference ?? null,
        notes: `Payment for PO ${po.po_no}`,
      })
      .select("*")
      .single();
    if (payment) {
      await postPaymentJournal(payment);
      await recomputePurchaseStatus(id);
    }
    revalidatePath("/purchases");
    revalidatePath("/payments");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function cancelPurchase(id: string): Promise<Result> {
  try {
    await requirePermission("purchases", "edit");
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: po } = await supabase.from("purchases").select("*").eq("id", id).single();
    if (!po) return { ok: false, error: "Not found" };
    if (po.status === "cancelled") return { ok: false, error: "Already cancelled" };
    if (po.status === "received" || po.status === "paid") {
      for (const l of (po.items as PurchaseLine[])) {
        const { data: it } = await admin.from("products").select("current_stock").eq("id", l.refId).single();
        if (!it) continue;
        await admin.from("products").update({ current_stock: Math.max(0, Number(it.current_stock) - Number(l.qty)) }).eq("id", l.refId);
      }
      // Reverse the inventory + payment journals so the books rebalance.
      await reverseJournalsForSource("purchase", id);
      // Also reverse any payment journals that were posted for payments
      // attached to this purchase.
      const { data: linkedPayments } = await admin
        .from("payments").select("id").eq("purchase_id", id);
      for (const p of (linkedPayments || [])) {
        await reverseJournalsForSource("payment", p.id);
      }
    }
    const { error } = await supabase.from("purchases").update({ status: "cancelled" }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await recomputePurchaseStatus(id); // drops this PO from the supplier's balance
    revalidatePath("/purchases");
    revalidatePath("/payments");
    revalidatePath("/products");
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deletePurchase(id: string): Promise<Result> {
  try {
    await requirePermission("purchases", "delete");
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: po } = await supabase.from("purchases").select("*").eq("id", id).single();
    if (!po) return { ok: false, error: "Not found" };
    if (po.status === "received" || po.status === "paid") {
      for (const l of (po.items as PurchaseLine[])) {
        const { data: it } = await admin.from("products").select("current_stock").eq("id", l.refId).single();
        if (!it) continue;
        await admin.from("products").update({ current_stock: Math.max(0, Number(it.current_stock) - Number(l.qty)) }).eq("id", l.refId);
      }
      await reverseJournalsForSource("purchase", id);
      const { data: linkedPayments } = await admin
        .from("payments").select("id").eq("purchase_id", id);
      for (const p of (linkedPayments || [])) {
        await reverseJournalsForSource("payment", p.id);
      }
    }
    const { error } = await supabase.from("purchases").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/purchases");
    revalidatePath("/payments");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function bulkCancelPurchases(ids: string[]) {
  try {
    await requirePermission("purchases", "edit");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    let cancelled = 0;
    for (const id of ids) { const r = await cancelPurchase(id); if (r.ok) cancelled++; }
    return { ok: true, message: `${cancelled} purchase(s) cancelled` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function bulkDeletePurchases(ids: string[]) {
  try {
    await requirePermission("purchases", "delete");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    let deleted = 0;
    for (const id of ids) { const r = await deletePurchase(id); if (r.ok) deleted++; }
    return { ok: true, message: `${deleted} purchase(s) deleted` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function exportPurchases(
  q?: string, status?: string, purchase_type?: string, supplier_id?: string,
  from?: string, to?: string,
) {
  try {
    await requirePermission("purchases", "view");
    const supabase = await createClient();
    let query = supabase.from("purchases").select("*, suppliers(name)").order("date", { ascending: false });
    if (q) query = query.ilike("po_no", `%${q}%`);
    if (status) query = query.eq("status", status);
    if (purchase_type) query = query.eq("purchase_type", purchase_type);
    if (supplier_id) query = query.eq("supplier_id", supplier_id);
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const csv = objectsToCsv((data as Array<Record<string, unknown> & { suppliers: { name: string } | null }>) || [], [
      { key: "po_no", header: "PO" },
      { key: "date", header: "Date" },
      { key: "supplier", header: "Supplier", map: (r) => (r.suppliers as { name?: string } | null)?.name || "" },
      { key: "purchase_type", header: "Type" },
      { key: "subtotal", header: "Subtotal" },
      { key: "discount", header: "Discount" },
      { key: "tax", header: "Tax" },
      { key: "total", header: "Total" },
      { key: "amount_paid", header: "Paid" },
      { key: "balance", header: "Balance",
        map: (r) => (Number(r.total) - Number(r.amount_paid || 0)).toFixed(2) },
      { key: "status", header: "Status" },
      { key: "due_date", header: "Due Date" },
    ]);
    return { ok: true, csv, filename: `purchases-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
