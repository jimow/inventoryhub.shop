"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { objectsToCsv } from "@/lib/csv";
import { computeLineTotals } from "@/lib/utils";
import {
  postSaleJournal, postCogsJournal, postPaymentJournal, recomputeSaleStatus, reverseJournalsForSource,
  recomputeCustomerBalance,
} from "@/lib/accounting";
import type { SaleLine, SaleType } from "@/lib/types";

/** Receipt info returned by createSale/confirmSale for cash sales so the UI
 * can show a print dialog without re-fetching anything. */
export type SaleReceipt = {
  sale_id: string;
  invoice_no: string;
  payment_no?: string;
  total: number;
  tendered?: number;
  change_due?: number;
  date: string;
  method_name?: string;
};

type Result = { ok: boolean; error?: string; receipt?: SaleReceipt };

function readForm(formData: FormData, inclusive: boolean) {
  const itemsRaw = String(formData.get("items") || "[]");
  let items: SaleLine[] = [];
  try { items = JSON.parse(itemsRaw); } catch {}
  const discount = Number(formData.get("discount") || 0);
  const tax_rate = Number(formData.get("tax_rate") || 0);
  // Honors Settings → Currency & Tax → "Prices are tax-inclusive" so what the
  // user types as the line price is what the customer pays (tax extracted).
  const { subtotal, tax, total } = computeLineTotals(items, discount, tax_rate, inclusive);
  const sale_type = (String(formData.get("sale_type") || "cash") as SaleType);
  const due_date = String(formData.get("due_date") || "") || null;
  return {
    invoice_no: String(formData.get("invoice_no") || "").trim(),
    date: String(formData.get("date") || new Date().toISOString().slice(0, 10)),
    customer_id: String(formData.get("customer_id") || "") || null,
    items, subtotal, discount, tax_rate, tax, total, sale_type,
    due_date: sale_type === "invoice" ? due_date : null,
    notes: String(formData.get("notes") || "") || null,
  };
}

export async function createSale(formData: FormData): Promise<Result> {
  try {
    await requirePermission("sales", "create");
    const cfg = await getSettings();
    const payload = readForm(formData, !!cfg.tax?.inclusive);
    if (!payload.invoice_no) payload.invoice_no = await reserveNextNumber("nextInvoice", cfg.numbering?.invoicePrefix || "INV-");
    if (!payload.customer_id) return { ok: false, error: "Customer required" };
    if (!payload.items.length) return { ok: false, error: "Add at least one line" };

    // How much the customer pays NOW. Cash sales may pay partially; credit/
    // invoice pay nothing now. The unpaid remainder is the credit they're taking.
    const tenderedRaw = formData.get("tendered");
    const tendered = tenderedRaw != null && String(tenderedRaw).length > 0 ? Number(tenderedRaw) : payload.total;
    const paidRaw = formData.get("paid");
    const paidNow = payload.sale_type === "cash"
      ? (paidRaw != null && String(paidRaw).length > 0
          ? Math.max(0, Math.min(Number(paidRaw), payload.total))
          : payload.total)
      : 0;
    const creditPortion = Math.max(0, Math.round((payload.total - paidNow) * 100) / 100);

    // Strict credit limit: refuse if the UNPAID portion of THIS sale would push
    // the customer's live exposure past their limit (0 = no limit). Live
    // exposure sums every non-cancelled sale (incl. drafts) so it can't be
    // bypassed by stacking pending sales or by paying only part in cash.
    if (creditPortion > 0.01) {
      const admin = createServiceClient();
      const { data: cust } = await admin
        .from("customers").select("name, credit_limit").eq("id", payload.customer_id).single();
      const limit = Number(cust?.credit_limit || 0);
      if (limit > 0) {
        const { data: rows } = await admin
          .from("sales").select("total, amount_paid")
          .eq("customer_id", payload.customer_id).neq("status", "cancelled");
        const outstanding = (rows || []).reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid || 0)), 0);
        if (outstanding + creditPortion > limit + 0.01) {
          return {
            ok: false,
            error: `Credit limit exceeded for ${cust?.name ?? "customer"}: limit ${limit.toFixed(2)}, ` +
                   `outstanding ${outstanding.toFixed(2)}, credit on this sale ${creditPortion.toFixed(2)} ` +
                   `(would be ${(outstanding + creditPortion).toFixed(2)}). Take more payment or raise the limit.`,
          };
        }
      }
    }

    const supabase = await createClient();
    const { data: created, error } = await supabase
      .from("sales")
      .insert({ ...payload, status: "draft" })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: error?.message || "Insert failed" };
    // Reflect the new (draft) sale in the customer's cached balance immediately.
    if (payload.sale_type !== "cash") await recomputeCustomerBalance(payload.customer_id);
    revalidatePath("/sales");
    revalidatePath("/customers");

    // Cash sales auto-confirm and create the cash receipt for paidNow.
    if (payload.sale_type === "cash") {
      return await confirmSale(created.id, tendered, paidNow);
    }

    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function updateSale(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("sales", "edit");
    const supabase = await createClient();
    const { data: existing } = await supabase.from("sales").select("status").eq("id", id).single();
    if (!existing) return { ok: false, error: "Sale not found" };
    if (existing.status !== "draft") return { ok: false, error: "Only draft sales can be edited" };
    const cfg = await getSettings();
    const payload = readForm(formData, !!cfg.tax?.inclusive);
    if (!payload.items.length) return { ok: false, error: "Add at least one line" };

    // Re-check the credit limit on edit (the new total must still fit), using
    // live exposure EXCLUDING this sale (it's being replaced).
    if (payload.sale_type !== "cash" && payload.customer_id) {
      const admin = createServiceClient();
      const { data: cust } = await admin
        .from("customers").select("name, credit_limit").eq("id", payload.customer_id).single();
      const limit = Number(cust?.credit_limit || 0);
      if (limit > 0) {
        const { data: rows } = await admin
          .from("sales").select("total, amount_paid")
          .eq("customer_id", payload.customer_id).neq("status", "cancelled").neq("id", id);
        const outstanding = (rows || []).reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid || 0)), 0);
        if (outstanding + payload.total > limit + 0.01) {
          return {
            ok: false,
            error: `Credit limit exceeded for ${cust?.name ?? "customer"}: limit ${limit.toFixed(2)}, ` +
                   `outstanding ${outstanding.toFixed(2)}, this sale ${payload.total.toFixed(2)}.`,
          };
        }
      }
    }

    const { error } = await supabase.from("sales").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    if (payload.customer_id) await recomputeCustomerBalance(payload.customer_id);
    revalidatePath("/sales");
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Confirm a sale: deduct stock, post sale journal (Dr AR / Cr Sales / Cr Tax),
 * set status. For a cash sale we auto-create the matching payment so AR is
 * cleared; if `tendered` is supplied, the receipt's tendered/change is shown.
 *
 * Failures from journal posting now surface as errors instead of being
 * silently swallowed — without this, missing accounts or a missing cash
 * payment method would leave the sale "confirmed" with no GL impact.
 */
export async function confirmSale(id: string, tendered?: number, paidAmount?: number): Promise<Result> {
  try {
    await requirePermission("sales", "edit");
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: sale } = await supabase.from("sales").select("*").eq("id", id).single();
    if (!sale) return { ok: false, error: "Sale not found" };
    if (sale.status !== "draft") return { ok: false, error: "Only draft sales can be confirmed" };

    // -----------------------------------------------------------------------
    // PRE-FLIGHT: verify chart-of-accounts is set up AND a cash payment
    // method exists (if cash sale). Catches missing-migration / missing-setup
    // issues BEFORE we touch stock — so the sale stays a clean draft if the
    // ledger isn't ready, instead of getting half-confirmed with no journal.
    // -----------------------------------------------------------------------
    const requiredCodes = ["1200", "4000", "5000", "1300"];
    if (Number(sale.tax) > 0) requiredCodes.push("2100");
    if (sale.sale_type === "cash") requiredCodes.push("1010"); // cash drawer
    const { data: accs } = await admin
      .from("accounts")
      .select("code")
      .in("code", requiredCodes);
    const haveCodes = new Set((accs || []).map((a) => a.code));
    const missing = requiredCodes.filter((c) => !haveCodes.has(c));
    if (missing.length) {
      return {
        ok: false,
        error: `Chart of accounts is missing required account code(s): ${missing.join(", ")}. ` +
               `Go to Chart of Accounts and add them (or re-apply migration 00005).`,
      };
    }
    let cashPm: { id: string; name: string } | null = null;
    if (sale.sale_type === "cash") {
      const { data } = await admin
        .from("payment_methods")
        .select("id, name")
        .eq("kind", "cash")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      cashPm = (data as { id: string; name: string } | null) ?? null;
      if (!cashPm) {
        return {
          ok: false,
          error: "No active Cash payment method configured. Add one under Settings → Payment Methods before recording cash sales.",
        };
      }
    }

    // Settings: allow-negative-stock? (tenant-safe — getSettings is scoped)
    const cfg = await getSettings();
    const allowNegative = cfg.inventory?.allowNegativeStock === true;

    const lines: SaleLine[] = sale.items || [];
    // Pre-flight: stock available, and serial-tracked lines have the right
    // number of units selected — fail before mutating anything.
    for (const l of lines) {
      const { data: p } = await admin.from("products").select("id,current_stock,name,serial_tracked").eq("id", l.refId).single();
      if (!p) return { ok: false, error: `Product ${l.name} not found` };
      if (!allowNegative && Number(p.current_stock) < Number(l.qty)) return { ok: false, error: `Not enough stock for ${p.name}` };
      if (p.serial_tracked && (l.unit_ids || []).length !== Number(l.qty)) {
        return { ok: false, error: `${l.name} is serial-tracked: select ${l.qty} serial unit(s) (got ${(l.unit_ids || []).length}).` };
      }
    }
    // Consume: decrement stock and, for serial-tracked products, mark the
    // chosen units sold (so they can never be sold again). Capture FIFO costs.
    const lineCosts: Record<string, number> = {};
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const { data: p } = await admin.from("products").select("current_stock, serial_tracked").eq("id", l.refId).single();
      if (!p) continue;
      await admin.from("products").update({ current_stock: Number(p.current_stock) - Number(l.qty) }).eq("id", l.refId);
      if (p.serial_tracked) {
        const ids = l.unit_ids || [];
        const { data: units } = await admin.from("inventory_units").select("id, cost, status").in("id", ids);
        const live = (units || []).filter((u) => u.status === "in_stock");
        if (live.length !== ids.length) {
          return { ok: false, error: `${l.name}: one or more selected units are no longer in stock.` };
        }
        lineCosts[l.refId] = live.reduce((s, u) => s + Number(u.cost), 0) / Math.max(1, live.length);
        await admin.from("inventory_units").update({ status: "sold", sale_id: sale.id, sale_line_idx: i }).in("id", ids);
      }
    }
    const { error } = await supabase.from("sales").update({ status: "confirmed" }).eq("id", id);
    if (error) return { ok: false, error: error.message };

    // Post the AR/Revenue/Tax journal — fail loudly if it doesn't post.
    const saleJ = await postSaleJournal(sale);
    if (!saleJ.ok) {
      return { ok: false, error: `Sale journal failed: ${saleJ.error}` };
    }
    // Post COGS — also fail loudly. (Returns ok with 0 cogs if products have
    // no cost_price, which is fine — no GL impact in that case.)
    const cogsJ = await postCogsJournal(sale, lineCosts);
    if (!cogsJ.ok) {
      return { ok: false, error: `COGS journal failed: ${cogsJ.error}` };
    }

    let receipt: SaleReceipt | undefined;

    // For CASH sales, auto-create a Payment via the default Cash method and
    // post its journal so AR is cleared (Dr Cash / Cr AR) — exactly mirroring
    // the cash-purchase auto-pay flow. Without this the books stay imbalanced
    // (AR never relieved) on every cash confirmation.
    if (sale.sale_type === "cash" && cashPm) {
      const total = Number(sale.total);
      // How much is actually paid now (defaults to full). The rest stays as an
      // AR balance against the customer — the sale journal already booked full
      // AR, so a partial receipt naturally leaves the balance owing.
      const payAmt = paidAmount != null && Number.isFinite(paidAmount)
        ? Math.max(0, Math.min(paidAmount, total))
        : total;

      let paymentNoForReceipt: string | null = null;
      if (payAmt > 0) {
        const payment_no = await reserveNextNumber("nextPayment", "PMT-");
        const { data: payment, error: payErr } = await admin
          .from("payments")
          .insert({
            payment_no,
            date: new Date().toISOString().slice(0, 10),
            direction: "in",
            source_type: "sale",
            sale_id: sale.id,
            customer_id: sale.customer_id,
            payment_method_id: cashPm.id,
            amount: payAmt,
            notes: payAmt < total
              ? `Partial cash receipt for ${sale.invoice_no} (balance ${(total - payAmt).toFixed(2)})`
              : `Auto cash receipt for ${sale.invoice_no}`,
          })
          .select("*")
          .single();
        if (payErr || !payment) {
          return { ok: false, error: `Cash payment record failed: ${payErr?.message || "unknown"}` };
        }
        const payJ = await postPaymentJournal(payment);
        if (!payJ.ok) {
          return { ok: false, error: `Cash receipt journal failed: ${payJ.error}` };
        }
        paymentNoForReceipt = payment.payment_no;
      }

      await recomputeSaleStatus(sale.id);

      // Build the receipt payload for the client print dialog. Change is only
      // possible when paying in full; a partial payment leaves a balance.
      const paidInFull = payAmt >= total - 0.01;
      const tenderedAmt = paidInFull && tendered != null && Number.isFinite(tendered) && tendered >= total
        ? tendered
        : payAmt;
      const change_due = paidInFull ? Math.round((tenderedAmt - total) * 100) / 100 : 0;
      receipt = {
        sale_id: sale.id,
        invoice_no: sale.invoice_no,
        payment_no: paymentNoForReceipt ?? "",
        total,
        tendered: tenderedAmt,
        change_due,
        date: new Date().toISOString(),
        method_name: cashPm.name || "Cash",
      };
    }

    revalidatePath("/sales");
    revalidatePath("/payments");
    revalidatePath("/receipts");
    revalidatePath("/products");
    revalidatePath("/customers");
    revalidatePath("/dashboard");
    return { ok: true, receipt };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Record a payment against a sale. Creates a row in `payments`, posts the
 * journal (Dr asset / Cr AR), then recomputes sale status (paid when total
 * payments >= sale total).
 */
export async function recordSalePayment(
  sale_id: string,
  amount: number,
  payment_method_id: string,
  reference?: string | null
): Promise<Result> {
  try {
    await requirePermission("sales", "edit");
    if (!amount || amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!payment_method_id) return { ok: false, error: "Payment method required" };
    const admin = createServiceClient();
    const { data: sale } = await admin.from("sales").select("*").eq("id", sale_id).single();
    if (!sale) return { ok: false, error: "Sale not found" };
    if (sale.status !== "confirmed") return { ok: false, error: "Only confirmed (unpaid) sales accept payments" };

    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const { data: pay, error } = await admin.from("payments").insert({
      payment_no,
      date: new Date().toISOString().slice(0, 10),
      direction: "in",
      source_type: "sale",
      sale_id,
      customer_id: sale.customer_id,
      payment_method_id,
      amount,
      reference: reference ?? null,
    }).select("*").single();
    if (error || !pay) return { ok: false, error: error?.message || "Failed to record payment" };

    await postPaymentJournal(pay);
    await recomputeSaleStatus(sale_id);
    revalidatePath("/sales");
    revalidatePath("/payments");
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function cancelSale(id: string): Promise<Result> {
  try {
    await requirePermission("sales", "edit");
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: sale } = await supabase.from("sales").select("*").eq("id", id).single();
    if (!sale) return { ok: false, error: "Sale not found" };
    if (sale.status === "cancelled") return { ok: false, error: "Already cancelled" };
    if (sale.status === "confirmed" || sale.status === "paid") {
      for (const l of sale.items as SaleLine[]) {
        const { data: p } = await admin.from("products").select("current_stock").eq("id", l.refId).single();
        if (!p) continue;
        await admin.from("products").update({ current_stock: Number(p.current_stock) + Number(l.qty) }).eq("id", l.refId);
      }
      // Reverse any sale + payment journals tied to this sale
      await reverseJournalsForSource("sale", id);
      const { data: pays } = await admin.from("payments").select("id").eq("sale_id", id);
      for (const p of pays || []) {
        await reverseJournalsForSource("payment", p.id);
      }
    }
    const { error } = await supabase.from("sales").update({ status: "cancelled" }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await recomputeSaleStatus(id); // drops this sale from the customer's balance
    revalidatePath("/sales");
    revalidatePath("/products");
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deleteSale(id: string): Promise<Result> {
  try {
    await requirePermission("sales", "delete");
    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: sale } = await supabase.from("sales").select("*").eq("id", id).single();
    if (!sale) return { ok: false, error: "Sale not found" };
    if (sale.status === "confirmed" || sale.status === "paid") {
      for (const l of sale.items as SaleLine[]) {
        const { data: p } = await admin.from("products").select("current_stock").eq("id", l.refId).single();
        if (!p) continue;
        await admin.from("products").update({ current_stock: Number(p.current_stock) + Number(l.qty) }).eq("id", l.refId);
      }
      await reverseJournalsForSource("sale", id);
      const { data: pays } = await admin.from("payments").select("id").eq("sale_id", id);
      for (const p of pays || []) {
        await reverseJournalsForSource("payment", p.id);
      }
    }
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/sales");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function bulkCancelSales(ids: string[]) {
  try {
    await requirePermission("sales", "edit");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    let cancelled = 0;
    for (const id of ids) { const r = await cancelSale(id); if (r.ok) cancelled++; }
    return { ok: true, message: `${cancelled} sale(s) cancelled` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function bulkDeleteSales(ids: string[]) {
  try {
    await requirePermission("sales", "delete");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    let deleted = 0;
    for (const id of ids) { const r = await deleteSale(id); if (r.ok) deleted++; }
    return { ok: true, message: `${deleted} sale(s) deleted` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function exportSales(
  q?: string, status?: string, sale_type?: string, customer_id?: string,
  from?: string, to?: string
) {
  try {
    await requirePermission("sales", "view");
    const supabase = await createClient();
    let query = supabase.from("sales").select("*, customers(name)").order("date", { ascending: false });
    if (q) query = query.ilike("invoice_no", `%${q}%`);
    if (status) query = query.eq("status", status);
    if (sale_type) query = query.eq("sale_type", sale_type);
    if (customer_id) query = query.eq("customer_id", customer_id);
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const csv = objectsToCsv((data as Array<Record<string, unknown> & { customers: { name: string } | null }>) || [], [
      { key: "invoice_no", header: "Invoice" },
      { key: "date", header: "Date" },
      { key: "customer", header: "Customer", map: (r) => (r.customers as { name?: string } | null)?.name || "" },
      { key: "sale_type", header: "Type" },
      { key: "subtotal", header: "Subtotal" },
      { key: "discount", header: "Discount" },
      { key: "tax", header: "Tax" },
      { key: "total", header: "Total" },
      { key: "status", header: "Status" },
      { key: "due_date", header: "Due Date" },
    ]);
    return { ok: true, csv, filename: `sales-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * List in-stock serial units for a product, for the sales serial picker.
 * Mirrors the POS picker but gated on the `sales` permission.
 */
export async function listSaleUnits(
  product_id: string,
  search?: string,
): Promise<{ ok: boolean; error?: string; units?: { id: string; serial_no: string; barcode: string | null; cost: number }[] }> {
  try {
    await requirePermission("sales", "view");
    const admin = createServiceClient();
    let query = admin
      .from("inventory_units")
      .select("id, serial_no, barcode, cost")
      .eq("product_id", product_id)
      .eq("status", "in_stock")
      .order("created_at", { ascending: true })
      .limit(200);
    const q = (search || "").trim();
    if (q) query = query.or(`serial_no.ilike.%${q}%,barcode.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    return { ok: true, units: data || [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
