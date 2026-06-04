"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber } from "@/lib/numbering";
import {
  postSalesReturnJournal, postPurchaseReturnJournal, resolvePaymentMethodAccountCode,
  assertSufficientFunds, recomputeCustomerBalance, recomputeSupplierBalance, reverseJournalsForSource,
} from "@/lib/accounting";
import type { ReturnLine } from "@/lib/types";

type Result = { ok: boolean; error?: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

type Unit = { id: string; serial_no: string; barcode: string | null };

/** Serial units that were SOLD on a given sale and NOT yet returned (candidates
 *  for a sales return). A returned unit is flipped back to in-stock so it leaves
 *  this list; we also drop any unit id recorded on a prior return as a safeguard. */
export async function listSoldUnits(sale_id: string, product_id: string): Promise<{ ok: boolean; units?: Unit[]; error?: string }> {
  try {
    await requirePermission("returns", "view");
    const admin = createServiceClient();
    const tid = currentTenantId();
    const { data, error } = await admin.from("inventory_units")
      .select("id, serial_no, barcode")
      .eq("sale_id", sale_id).eq("product_id", product_id).eq("status", "sold")
      .order("serial_no");
    if (error) return { ok: false, error: error.message };

    // Belt & suspenders: exclude serials already recorded on a posted return.
    let rq = admin.from("sales_returns").select("items").eq("sale_id", sale_id).eq("status", "posted");
    if (tid) rq = rq.eq("tenant_id", tid);
    const { data: rets } = await rq;
    const returned = new Set<string>();
    for (const r of rets || []) for (const it of (r.items as ReturnLine[]) || []) for (const id of it.unit_ids || []) returned.add(id);

    return { ok: true, units: ((data as Unit[]) || []).filter((u) => !returned.has(u.id)) };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Serial units still in stock from a given purchase (candidates for a purchase return). */
export async function listPurchaseUnits(purchase_id: string, product_id: string): Promise<{ ok: boolean; units?: Unit[]; error?: string }> {
  try {
    await requirePermission("returns", "view");
    const admin = createServiceClient();
    const { data, error } = await admin.from("inventory_units")
      .select("id, serial_no, barcode")
      .eq("purchase_id", purchase_id).eq("product_id", product_id).eq("status", "in_stock")
      .order("serial_no");
    if (error) return { ok: false, error: error.message };
    return { ok: true, units: (data as Unit[]) || [] };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/* -------------------------------------------------------------------------- */
/* SALES RETURN — customer returns goods                                      */
/* -------------------------------------------------------------------------- */
export async function createSalesReturn(input: {
  sale_id: string;
  lines: ReturnLine[];
  refund_method: "cash" | "credit";
  payment_method_id?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { return_no?: string }> {
  try {
    await requirePermission("returns", "create");
    const admin = createServiceClient();
    const tid = currentTenantId();
    const lines = (input.lines || []).filter((l) => l.refId && Number(l.qty) > 0);
    if (!lines.length) return { ok: false, error: "Select at least one item and quantity to return" };

    const { data: sale } = await admin.from("sales").select("*").eq("id", input.sale_id).single();
    if (!sale) return { ok: false, error: "Sale not found" };
    if (sale.status === "cancelled") return { ok: false, error: "Cannot return a cancelled sale" };

    // Cap each line to what's still returnable (sold qty − already returned).
    let rq = admin.from("sales_returns").select("items, status").eq("sale_id", input.sale_id).eq("status", "posted");
    if (tid) rq = rq.eq("tenant_id", tid);
    const { data: priorReturns } = await rq;
    const returnedQty = new Map<string, number>();
    for (const pr of priorReturns || []) {
      for (const it of (pr.items as ReturnLine[]) || []) {
        returnedQty.set(it.refId, (returnedQty.get(it.refId) || 0) + Number(it.qty));
      }
    }
    const saleQty = new Map<string, number>();
    for (const it of (sale.items as ReturnLine[]) || []) saleQty.set(it.refId, (saleQty.get(it.refId) || 0) + Number(it.qty));
    for (const l of lines) {
      const max = (saleQty.get(l.refId) || 0) - (returnedQty.get(l.refId) || 0);
      if (Number(l.qty) > max + 0.001) return { ok: false, error: `${l.name}: only ${max} left to return` };
    }

    // Money: subtotal at sale price, tax proportional to the original sale.
    const subtotal = r2(lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0));
    const taxRate = Number(sale.subtotal) > 0 ? Number(sale.tax) / Number(sale.subtotal) : 0;
    const tax = r2(subtotal * taxRate);
    const total = r2(subtotal + tax);

    // Cash refund pays money out — don't refund what you don't have.
    let cashCode = "1010";
    if (input.refund_method === "cash") {
      const funds = await assertSufficientFunds(input.payment_method_id ?? null, total, "the refund account");
      if (!funds.ok) return { ok: false, error: funds.error };
      cashCode = await resolvePaymentMethodAccountCode(admin, input.payment_method_id ?? null);
    }

    // Stock back + COGS cost basis. Serial lines flip their units back in stock.
    let cost = 0;
    for (const l of lines) {
      const { data: p } = await admin.from("products").select("current_stock, cost_price, serial_tracked, name").eq("id", l.refId).single();
      if (!p) continue;
      await admin.from("products").update({ current_stock: Number(p.current_stock) + Number(l.qty) }).eq("id", l.refId);
      if (p.serial_tracked && (l.unit_ids?.length ?? 0) > 0) {
        const ids = l.unit_ids!.slice(0, Number(l.qty));
        const { data: units } = await admin.from("inventory_units").select("id, cost").in("id", ids);
        cost += (units || []).reduce((s, u) => s + Number(u.cost || 0), 0);
        await admin.from("inventory_units").update({ status: "in_stock", sale_id: null, sale_line_idx: null }).in("id", ids);
      } else {
        cost += Number(l.qty) * Number(p.cost_price || 0);
      }
    }
    cost = r2(cost);

    const return_no = await reserveNextNumber("nextSalesReturn", "SR-");
    const { userId } = await getCurrentSession();
    const supabase = await createClient();
    const { data: row, error } = await supabase.from("sales_returns").insert({
      return_no, sale_id: input.sale_id, customer_id: sale.customer_id,
      date: input.date || new Date().toISOString().slice(0, 10),
      items: lines, subtotal, tax, total,
      refund_method: input.refund_method,
      payment_method_id: input.refund_method === "cash" ? (input.payment_method_id ?? null) : null,
      notes: input.notes ?? null, status: "posted", created_by: userId,
    }).select("id").single();
    if (error || !row) return { ok: false, error: error?.message || "Failed to record return" };

    const j = await postSalesReturnJournal({
      date: input.date || new Date().toISOString().slice(0, 10),
      return_no, source_id: row.id as string, net: subtotal, tax, total, cost,
      refund: input.refund_method, cashCode,
    });
    if (!j.ok) { await supabase.from("sales_returns").delete().eq("id", row.id); return { ok: false, error: `Journal failed: ${j.error}` }; }
    await admin.from("sales_returns").update({ journal_entry_id: j.entry_id ?? null }).eq("id", row.id);
    await recomputeCustomerBalance(sale.customer_id as string | null);

    revalidatePath("/returns"); revalidatePath("/sales"); revalidatePath("/products"); revalidatePath("/reports");
    return { ok: true, return_no };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/* -------------------------------------------------------------------------- */
/* PURCHASE RETURN — we return goods to a supplier                            */
/* -------------------------------------------------------------------------- */
export async function createPurchaseReturn(input: {
  purchase_id: string;
  lines: ReturnLine[];
  refund_method: "cash" | "balance";
  payment_method_id?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { return_no?: string }> {
  try {
    await requirePermission("returns", "create");
    const admin = createServiceClient();
    const tid = currentTenantId();
    const lines = (input.lines || []).filter((l) => l.refId && Number(l.qty) > 0);
    if (!lines.length) return { ok: false, error: "Select at least one item and quantity to return" };

    const { data: po } = await admin.from("purchases").select("*").eq("id", input.purchase_id).single();
    if (!po) return { ok: false, error: "Purchase not found" };
    if (po.status === "cancelled") return { ok: false, error: "Cannot return a cancelled purchase" };

    let rq = admin.from("purchase_returns").select("items").eq("purchase_id", input.purchase_id).eq("status", "posted");
    if (tid) rq = rq.eq("tenant_id", tid);
    const { data: priorReturns } = await rq;
    const returnedQty = new Map<string, number>();
    for (const pr of priorReturns || []) for (const it of (pr.items as ReturnLine[]) || []) returnedQty.set(it.refId, (returnedQty.get(it.refId) || 0) + Number(it.qty));
    const poQty = new Map<string, number>();
    for (const it of (po.items as ReturnLine[]) || []) poQty.set(it.refId, (poQty.get(it.refId) || 0) + Number(it.qty));
    for (const l of lines) {
      const max = (poQty.get(l.refId) || 0) - (returnedQty.get(l.refId) || 0);
      if (Number(l.qty) > max + 0.001) return { ok: false, error: `${l.name}: only ${max} left to return` };
    }

    const subtotal = r2(lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0));
    const taxRate = Number(po.subtotal) > 0 ? Number(po.tax) / Number(po.subtotal) : 0;
    const tax = r2(subtotal * taxRate);
    const total = r2(subtotal + tax);

    // Stock out. For serial items, remove the returned units from stock.
    for (const l of lines) {
      const { data: p } = await admin.from("products").select("current_stock, serial_tracked").eq("id", l.refId).single();
      if (!p) continue;
      await admin.from("products").update({ current_stock: Math.max(0, Number(p.current_stock) - Number(l.qty)) }).eq("id", l.refId);
      if (p.serial_tracked) {
        const ids = (l.unit_ids && l.unit_ids.length) ? l.unit_ids.slice(0, Number(l.qty)) : null;
        if (ids) {
          await admin.from("inventory_units").delete().in("id", ids);
        } else {
          // Fall back: remove N in-stock units from this PO.
          const { data: units } = await admin.from("inventory_units")
            .select("id").eq("product_id", l.refId).eq("purchase_id", input.purchase_id).eq("status", "in_stock").limit(Number(l.qty));
          if (units?.length) await admin.from("inventory_units").delete().in("id", units.map((u) => u.id));
        }
      }
    }

    let cashCode = "1010";
    if (input.refund_method === "cash") cashCode = await resolvePaymentMethodAccountCode(admin, input.payment_method_id ?? null);

    const return_no = await reserveNextNumber("nextPurchaseReturn", "PR-");
    const { userId } = await getCurrentSession();
    const supabase = await createClient();
    const { data: row, error } = await supabase.from("purchase_returns").insert({
      return_no, purchase_id: input.purchase_id, supplier_id: po.supplier_id,
      date: input.date || new Date().toISOString().slice(0, 10),
      items: lines, subtotal, tax, total,
      refund_method: input.refund_method,
      payment_method_id: input.refund_method === "cash" ? (input.payment_method_id ?? null) : null,
      notes: input.notes ?? null, status: "posted", created_by: userId,
    }).select("id").single();
    if (error || !row) return { ok: false, error: error?.message || "Failed to record return" };

    const j = await postPurchaseReturnJournal({
      date: input.date || new Date().toISOString().slice(0, 10),
      return_no, source_id: row.id as string, net: subtotal, tax, total,
      refund: input.refund_method, cashCode,
    });
    if (!j.ok) { await supabase.from("purchase_returns").delete().eq("id", row.id); return { ok: false, error: `Journal failed: ${j.error}` }; }
    await admin.from("purchase_returns").update({ journal_entry_id: j.entry_id ?? null }).eq("id", row.id);
    await recomputeSupplierBalance(po.supplier_id as string | null);

    revalidatePath("/returns"); revalidatePath("/purchases"); revalidatePath("/products"); revalidatePath("/reports");
    return { ok: true, return_no };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
