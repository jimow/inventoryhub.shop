"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { postSaleJournal, postCogsJournal, postPaymentJournal, recomputeSaleStatus } from "@/lib/accounting";
import { stkPush, stkQuery, normalizeKenyanPhone } from "@/lib/mpesa";
import { computeTotals } from "@/lib/tax";
import type { SaleLine } from "@/lib/types";

export type PosCheckoutInput = {
  customer_id?: string | null;
  lines: SaleLine[];
  discount: number;
  tax_rate: number;
  payment_method_id: string;
  reference?: string | null;
  notes?: string | null;
  tendered_amount?: number | null;
  /** Amount actually paid now. If less than total, the rest is an AR balance
   *  (requires a customer). Defaults to the full total. */
  paid_amount?: number | null;
};

export type PosCheckoutResult = {
  ok: boolean;
  error?: string;
  sale_id?: string;
  invoice_no?: string;
  payment_no?: string;
  total?: number;
  tendered?: number;
  change_due?: number;
};

export async function checkoutPos(input: PosCheckoutInput): Promise<PosCheckoutResult> {
  try {
    await requirePermission("pos", "create");
    if (!input.lines.length) return { ok: false, error: "Cart is empty" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method required" };

    const supabase = await createClient();
    const admin = createServiceClient();
    const cfg = await getSettings();

    const totals = await computeTotals(input.lines, input.discount, input.tax_rate, "sales", !!cfg.tax?.inclusive);
    const { subtotal, discount, tax, total } = totals;

    // How much is actually paid now. If a partial amount is given, the rest
    // becomes an AR balance against the customer.
    const payAmt = input.paid_amount != null && Number.isFinite(Number(input.paid_amount))
      ? Math.max(0, Math.min(Number(input.paid_amount), total))
      : total;
    const paidInFull = payAmt >= total - 0.01;
    if (!paidInFull && !input.customer_id) {
      return { ok: false, error: "A customer is required for a partial payment (the balance is owed by the customer)." };
    }

    const tendered = paidInFull && input.tendered_amount != null ? Number(input.tendered_amount) : payAmt;
    if (paidInFull && tendered + 0.0001 < total) {
      return { ok: false, error: `Tendered (${tendered.toFixed(2)}) is less than total (${total.toFixed(2)})` };
    }
    const change_due = paidInFull ? Math.round((tendered - total) * 100) / 100 : 0;

    const allowNegative = cfg.inventory?.allowNegativeStock === true;
    for (const l of input.lines) {
      const { data: p } = await admin.from("products").select("id,current_stock,name").eq("id", l.refId).single();
      if (!p) return { ok: false, error: `Product ${l.name} not found` };
      if (!allowNegative && Number(p.current_stock) < Number(l.qty)) return { ok: false, error: `Not enough stock for ${p.name}` };
    }

    const invoice_no = await reserveNextNumber("nextInvoice", cfg.numbering?.invoicePrefix || "INV-");
    const { data: sale, error: saleErr } = await supabase
      .from("sales")
      .insert({
        invoice_no,
        date: new Date().toISOString().slice(0, 10),
        customer_id: input.customer_id ?? null,
        items: input.lines,
        subtotal, discount, tax_rate: Number(input.tax_rate) || 0, tax, total,
        sale_type: "cash",
        notes: input.notes ?? "POS sale",
        status: "confirmed",
      })
      .select("*")
      .single();
    if (saleErr || !sale) return { ok: false, error: saleErr?.message || "Failed to create sale" };

    // Stock relief + serial unit consumption.
    // For serial_tracked products we expect input.lines[i].unit_ids to match qty.
    // Mark those inventory_units sold and capture their costs for FIFO COGS.
    const lineCosts: Record<string, number> = {};
    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i];
      const { data: p } = await admin.from("products").select("current_stock, serial_tracked").eq("id", l.refId).single();
      if (!p) continue;
      await admin.from("products")
        .update({ current_stock: Number(p.current_stock) - Number(l.qty) })
        .eq("id", l.refId);

      if (p.serial_tracked) {
        const ids = l.unit_ids || [];
        if (ids.length !== Number(l.qty)) {
          return { ok: false, error: `${l.name} is serial-tracked: pick ${l.qty} unit(s) (got ${ids.length}).` };
        }
        const { data: units } = await admin
          .from("inventory_units")
          .select("id, cost, status")
          .in("id", ids);
        const live = (units || []).filter((u) => u.status === "in_stock");
        if (live.length !== ids.length) {
          return { ok: false, error: `${l.name}: one or more selected units are no longer available.` };
        }
        const avgUnit = live.reduce((s, u) => s + Number(u.cost), 0) / Math.max(1, live.length);
        lineCosts[l.refId] = avgUnit;
        await admin.from("inventory_units")
          .update({ status: "sold", sale_id: sale.id, sale_line_idx: i })
          .in("id", ids);
      }
    }

    await postSaleJournal(sale);
    await postCogsJournal(sale, lineCosts);

    // Build a descriptive notes line so the user can verify in /payments and on the receipt.
    const { data: pmRow } = await admin
      .from("payment_methods")
      .select("name, kind, meta")
      .eq("id", input.payment_method_id)
      .single();
    let notesLine = "POS payment";
    if (pmRow?.kind === "mpesa") {
      const tx = (pmRow.meta as { transaction_type?: string } | null)?.transaction_type;
      const sc = (pmRow.meta as { shortcode?: string } | null)?.shortcode;
      if (tx === "CustomerBuyGoodsOnline") notesLine = `M-Pesa Till ${sc ?? ""} · Lipa Na M-Pesa Online`;
      else if (tx === "CustomerPayBillOnline") notesLine = `M-Pesa PayBill ${sc ?? ""} · Lipa Na M-Pesa Online`;
      else notesLine = `M-Pesa (manual) · code ${input.reference ?? "—"}`;
    } else if (pmRow?.kind === "cash" && change_due > 0) {
      notesLine = `Cash · Tendered ${tendered.toFixed(2)} · Change ${change_due.toFixed(2)}`;
    } else if (pmRow?.name) {
      notesLine = `POS · ${pmRow.name}`;
    }

    let payment_no: string | undefined;
    if (payAmt > 0) {
      payment_no = await reserveNextNumber("nextPayment", "PMT-");
      const { data: payment } = await admin.from("payments").insert({
        payment_no,
        date: new Date().toISOString().slice(0, 10),
        direction: "in",
        source_type: "sale",
        sale_id: sale.id,
        customer_id: input.customer_id ?? null,
        payment_method_id: input.payment_method_id,
        amount: payAmt,
        tendered_amount: tendered,
        change_due,
        reference: input.reference ?? null,
        notes: paidInFull ? notesLine : `${notesLine} · partial (balance ${(total - payAmt).toFixed(2)})`,
      }).select("*").single();
      if (payment) {
        await postPaymentJournal(payment);
      }
    }
    await recomputeSaleStatus(sale.id);

    revalidatePath("/sales");
    revalidatePath("/payments");
    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true, sale_id: sale.id, invoice_no, payment_no, total, tendered, change_due };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type StkInitiateInput = {
  customer_id?: string | null;
  lines: SaleLine[];
  discount: number;
  tax_rate: number;
  phone: string;
  payment_method_id?: string | null;
  notes?: string | null;
};

export type StkInitiateResult = {
  ok: boolean;
  error?: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  sale_id?: string;
  invoice_no?: string;
  total?: number;
  customerMessage?: string;
};

export async function posStkInitiate(input: StkInitiateInput): Promise<StkInitiateResult> {
  try {
    await requirePermission("pos", "create");
    if (!input.lines.length) return { ok: false, error: "Cart is empty" };
    let phone: string;
    try { phone = normalizeKenyanPhone(input.phone); }
    catch (e) { return { ok: false, error: (e as Error).message }; }

    const { userId } = await getCurrentSession();
    const supabase = await createClient();
    const admin = createServiceClient();
    const cfg = await getSettings();

    const totals = await computeTotals(input.lines, input.discount, input.tax_rate, "sales", !!cfg.tax?.inclusive);
    const { subtotal, discount, tax, total } = totals;

    for (const l of input.lines) {
      const { data: p } = await admin.from("products").select("current_stock,name").eq("id", l.refId).single();
      if (!p) return { ok: false, error: `Product ${l.name} not found` };
      if (Number(p.current_stock) < Number(l.qty)) return { ok: false, error: `Not enough stock for ${p.name}` };
    }

    // Resolve PayBill vs Till + shortcode override.
    let methodMeta: { transaction_type?: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline"; shortcode?: string } = {};
    if (input.payment_method_id) {
      const { data: pm } = await admin
        .from("payment_methods")
        .select("kind, meta")
        .eq("id", input.payment_method_id)
        .single();
      if (pm?.kind === "mpesa" && pm.meta) methodMeta = pm.meta as typeof methodMeta;
    }

    // Use a temporary reference for the STK push so we don't burn an invoice
    // number if the push fails. We reserve the real invoice number AFTER STK
    // succeeds, then insert the sale (with retry on the rare duplicate-key race).
    const tempRef = `POS-${Date.now().toString(36).toUpperCase().slice(-8)}`;
    let push;
    try {
      push = await stkPush({
        amount: total,
        phone,
        accountReference: tempRef,
        description: `POS Sale`,
        transactionType: methodMeta.transaction_type,
        shortcode: methodMeta.shortcode,
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    // STK accepted -> now reserve invoice + create the draft sale, with retries
    // to survive the rare race where two parallel actions grab the same number.
    const prefix = cfg.numbering?.invoicePrefix || "INV-";
    let invoice_no = "";
    let sale: { id: string; invoice_no: string } | null = null;
    let lastErr: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      invoice_no = await reserveNextNumber("nextInvoice", prefix);
      const { data, error } = await supabase
        .from("sales")
        .insert({
          invoice_no,
          date: new Date().toISOString().slice(0, 10),
          customer_id: input.customer_id ?? null,
          items: input.lines,
          subtotal, discount, tax_rate: Number(input.tax_rate) || 0, tax, total,
          sale_type: "cash",
          notes: input.notes ?? `POS sale (M-Pesa pending)`,
          status: "draft",
        })
        .select("id, invoice_no")
        .single();
      if (data) { sale = data; break; }
      lastErr = error?.message;
      // 23505 = unique_violation; bump and retry.
      if (!error?.message?.toLowerCase().includes("duplicate")) break;
    }
    if (!sale) return { ok: false, error: lastErr || "Failed to create sale" };

    await admin.from("mpesa_stk").insert({
      checkout_request_id: push.CheckoutRequestID,
      merchant_request_id: push.MerchantRequestID,
      sale_id:             sale.id,
      payment_method_id:   input.payment_method_id ?? null,
      amount:              total,
      phone,
      account_reference:   sale.invoice_no,
      raw_request:         push.request,
      status:              "pending",
      created_by:          userId,
    });

    return {
      ok: true,
      checkoutRequestId: push.CheckoutRequestID,
      merchantRequestId: push.MerchantRequestID,
      sale_id: sale.id,
      invoice_no: sale.invoice_no,
      total,
      customerMessage: push.CustomerMessage,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type StkStatus =
  | { status: "pending"; }
  | { status: "success"; sale_id: string; invoice_no: string; mpesa_receipt_no: string | null; }
  | { status: "failed" | "cancelled" | "timeout"; result_desc: string; };

export async function posStkStatus(checkoutRequestId: string): Promise<StkStatus> {
  await requirePermission("pos", "view");
  const admin = createServiceClient();
  const { data: row } = await admin
    .from("mpesa_stk")
    .select("*, sales(invoice_no)")
    .eq("checkout_request_id", checkoutRequestId)
    .single();

  if (!row) return { status: "failed", result_desc: "STK request not found" };

  if (row.status === "success") {
    return {
      status: "success",
      sale_id: row.sale_id,
      invoice_no: row.sales?.invoice_no || "",
      mpesa_receipt_no: row.mpesa_receipt_no,
    };
  }
  if (row.status === "failed" || row.status === "cancelled" || row.status === "timeout") {
    return { status: row.status, result_desc: row.result_desc || "Failed" };
  }

  // Still pending — poll Daraja for a result. STK queries can fail in
  // various ways; we treat any error as "still pending" so the client keeps
  // polling (the C2B callback will overwrite the row once it lands).
  try {
    const q = await stkQuery(checkoutRequestId);
    const code = String(q.ResultCode);
    if (code === "0") {
      await admin.from("mpesa_stk").update({
        status: "success",
        result_code: 0,
        result_desc: q.ResultDesc,
      }).eq("checkout_request_id", checkoutRequestId);
      return { status: "pending" };
    }
    if (code === "1037") return { status: "pending" };
    if (code === "1032") return { status: "cancelled", result_desc: q.ResultDesc || "Cancelled by user" };
    return { status: "failed", result_desc: q.ResultDesc || `Result ${code}` };
  } catch {
    return { status: "pending" };
  }
}

/**
 * List available (in_stock) inventory_units for a serial-tracked product.
 * Optional `search` filters by serial number or barcode (substring match).
 * Used by the POS unit picker dialog.
 */
export async function listAvailableUnits(
  product_id: string,
  search?: string,
): Promise<{ ok: boolean; error?: string; units?: { id: string; serial_no: string; barcode: string | null; cost: number }[] }> {
  try {
    await requirePermission("pos", "view");
    const admin = createServiceClient();
    let query = admin
      .from("inventory_units")
      .select("id, serial_no, barcode, cost")
      .eq("product_id", product_id)
      .eq("status", "in_stock")
      .order("created_at", { ascending: true })
      .limit(200);
    const q = (search || "").trim();
    if (q) {
      // Match either the human-readable serial or the scanned barcode.
      query = query.or(`serial_no.ilike.%${q}%,barcode.ilike.%${q}%`);
    }
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    return { ok: true, units: data || [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
