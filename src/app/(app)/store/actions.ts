"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { postJournal, resolvePaymentMethodAccountCode, ensureChartOfAccounts } from "@/lib/accounting";

type Result = { ok: boolean; error?: string };

export type TransferInput = {
  productId: string;
  qty: number;
  direction: "to_shop" | "to_store";
  notes?: string;
  reference?: string;
  /** Transport / handling charge to move the goods (posts a journal). */
  charge?: number;
  /** Payment method the charge is paid from (null = cash drawer). */
  chargePaidFrom?: string | null;
  /** For serial-tracked products: the exact units to move (length must equal qty). */
  unitIds?: string[];
};

/**
 * List in-stock serial units sitting in a given location, for the transfer
 * picker so the operator can capture exactly which serials are moving.
 */
export async function listTransferUnits(
  productId: string,
  location: "shop" | "store",
  search?: string,
): Promise<{ ok: boolean; error?: string; units?: { id: string; serial_no: string; barcode: string | null }[] }> {
  try {
    await requirePermission("store", "view");
    const admin = createServiceClient();
    const tid = currentTenantId();
    let q = admin.from("inventory_units")
      .select("id, serial_no, barcode")
      .eq("product_id", productId).eq("status", "in_stock").eq("location", location)
      .order("created_at", { ascending: true }).limit(500);
    if (tid) q = q.eq("tenant_id", tid);
    const s = (search || "").trim();
    if (s) q = q.or(`serial_no.ilike.%${s}%,barcode.ilike.%${s}%`);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    return { ok: true, units: data || [] };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Move stock between the STORE (warehouse) and the SHOP (sales floor) as a
 * proper transfer document: numbered, with an optional reference, captured
 * serial numbers (for serial-tracked products), and an optional transport /
 * handling charge that posts double-entry per the shop's charge-handling
 * setting (capitalize into inventory vs. expense separately).
 */
export async function transferStock(input: TransferInput): Promise<Result> {
  try {
    await requirePermission("store", "create");
    const { productId, direction } = input;
    const amount = Math.max(0, Math.round((Number(input.qty) || 0) * 100) / 100);
    if (amount <= 0) return { ok: false, error: "Enter a quantity greater than 0" };
    if (direction !== "to_shop" && direction !== "to_store") return { ok: false, error: "Invalid direction" };
    const charge = Math.max(0, Math.round((Number(input.charge) || 0) * 100) / 100);

    const admin = createServiceClient();
    const tid = currentTenantId();
    let pq = admin.from("products").select("id, name, unit, current_stock, store_stock, cost_price, serial_tracked").eq("id", productId);
    if (tid) pq = pq.eq("tenant_id", tid);
    const { data: p } = await pq.single();
    if (!p) return { ok: false, error: "Product not found" };

    const shop = Number(p.current_stock) || 0;
    const store = Number(p.store_stock) || 0;
    const fromShop = direction === "to_store";
    const srcLoc = fromShop ? "shop" : "store";
    const dstLoc = fromShop ? "store" : "shop";
    const available = fromShop ? shop : store;
    if (amount > available + 0.001) {
      return { ok: false, error: `Only ${available} in the ${srcLoc} — can't transfer ${amount}.` };
    }

    // Resolve / validate the serial units that physically move.
    let movedSerials: { unit_id: string; serial_no: string }[] = [];
    if (p.serial_tracked) {
      const need = Math.round(amount);
      const picked = (input.unitIds || []).filter(Boolean);
      let uq = admin.from("inventory_units").select("id, serial_no")
        .eq("product_id", productId).eq("status", "in_stock").eq("location", srcLoc);
      if (tid) uq = uq.eq("tenant_id", tid);
      // Honor an explicit selection; otherwise take the oldest `need` units.
      if (picked.length) uq = uq.in("id", picked);
      else uq = uq.order("created_at", { ascending: true }).limit(need);
      const { data: units } = await uq;
      const rows = (units || []) as { id: string; serial_no: string }[];
      if (picked.length && rows.length !== picked.length) {
        return { ok: false, error: "Some selected serial units are no longer in this location." };
      }
      if (rows.length < need) {
        return { ok: false, error: `Only ${rows.length} serial unit(s) available in the ${srcLoc}; need ${need}.` };
      }
      const take = rows.slice(0, need);
      await admin.from("inventory_units").update({ location: dstLoc }).in("id", take.map((u) => u.id));
      movedSerials = take.map((u) => ({ unit_id: u.id, serial_no: u.serial_no }));
    }

    // Move the location counts. If the charge is capitalized, raise the product's
    // moving-average cost by charge / total-on-hand so item cost stays in step
    // with the Inventory account.
    const cfg = await getSettings();
    const capitalize = cfg.accounting?.chargeMode !== "expense";
    const totalOnHand = shop + store;
    const next: Record<string, number> = fromShop
      ? { current_stock: shop - amount, store_stock: store + amount }
      : { current_stock: shop + amount, store_stock: store - amount };
    if (charge > 0 && capitalize && totalOnHand > 0) {
      next.cost_price = Math.round((Number(p.cost_price || 0) + charge / totalOnHand) * 10000) / 10000;
    }
    const { error: upErr } = await admin.from("products").update(next).eq("id", productId);
    if (upErr) return { ok: false, error: upErr.message };

    const { userId } = await getCurrentSession();
    const date = new Date().toISOString().slice(0, 10);
    const transfer_no = await reserveNextNumber("nextTransfer", "TRF-");
    const { data: doc, error: insErr } = await admin.from("stock_transfers").insert({
      transfer_no,
      product_id: productId,
      qty: amount,
      direction,
      date,
      reference: input.reference?.trim() || null,
      charge,
      charge_paid_from: charge > 0 ? (input.chargePaidFrom || null) : null,
      serials: movedSerials,
      notes: input.notes?.trim() || null,
      created_by: userId,
    }).select("id").single();
    if (insErr || !doc) return { ok: false, error: insErr?.message || "Failed to record transfer" };

    // Charge double-entry: Dr (Inventory | Freight&Handling)  Cr (paid-from asset).
    if (charge > 0) {
      await ensureChartOfAccounts(admin);
      const assetCode = await resolvePaymentMethodAccountCode(admin, input.chargePaidFrom || null);
      const debitCode = capitalize ? "1300" : (cfg.accounting?.chargeAccountCode || "5300");
      const desc = `Transfer ${transfer_no} — ${p.name} (${fromShop ? "shop→store" : "store→shop"})`;
      const j = await postJournal({
        date,
        description: `Transfer charge ${transfer_no}`,
        source_type: "manual",
        source_id: doc.id,
        lines: [
          { account_code: debitCode, debit: charge, description: desc },
          { account_code: assetCode, credit: charge, description: desc },
        ],
      });
      if (j.ok && j.entry_id) {
        await admin.from("stock_transfers").update({ journal_entry_id: j.entry_id }).eq("id", doc.id);
      }
    }

    revalidatePath("/store");
    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
