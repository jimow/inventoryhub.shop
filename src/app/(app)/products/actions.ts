"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { objectsToCsv } from "@/lib/csv";
import { postJournal, ensureChartOfAccounts } from "@/lib/accounting";

type Result = { ok: boolean; error?: string };

/**
 * Record a stock adjustment with full double-entry posting.
 *
 *   Reason 'shrinkage' | 'damage' | 'write_off' | 'internal_use' (stock DECREASE):
 *      Dr  <expense account, default 5700 or 5800>      qty * cost
 *         Cr  Inventory 1300                            qty * cost
 *
 *   Reason 'found' | 'count' (stock INCREASE):
 *      Dr  Inventory 1300                                qty * cost
 *         Cr  Inventory Adjustment 5700 (or other income)
 *
 * The product's current_stock is updated and a stock_adjustments audit row
 * is inserted, linking back to the journal entry id.
 */
export async function recordStockAdjustment(input: {
  product_id: string;
  qty_change: number;          // signed; negative = stock down
  reason: "shrinkage" | "damage" | "write_off" | "internal_use" | "found" | "count" | "other";
  account_code?: string;       // defaults derived from reason
  notes?: string | null;
}): Promise<Result & { adjustment_id?: string }> {
  try {
    await requirePermission("products", "edit");
    if (!input.product_id) return { ok: false, error: "Product is required" };
    if (!input.qty_change || input.qty_change === 0) {
      return { ok: false, error: "Quantity change cannot be zero" };
    }

    const admin = createServiceClient();
    const { data: prod } = await admin
      .from("products")
      .select("id, name, cost_price, current_stock")
      .eq("id", input.product_id)
      .single();
    if (!prod) return { ok: false, error: "Product not found" };

    const unitCost = Number(prod.cost_price) || 0;
    const qty = Number(input.qty_change);
    const totalValue = Math.abs(qty * unitCost);
    const newStock = Math.max(0, Number(prod.current_stock) + qty);

    // Pick the non-inventory side account based on reason.
    const code = input.account_code
      || (input.reason === "write_off" ? "5800"
        : input.reason === "found"     ? "5700"  // credit side
        :                                "5700"); // shrinkage/damage/etc → expense

    // Bump stock.
    await admin.from("products").update({ current_stock: newStock }).eq("id", input.product_id);

    // Insert audit row.
    const { userId } = await getCurrentSession();
    const { data: adj } = await admin.from("stock_adjustments").insert({
      product_id: input.product_id,
      qty_change: qty,
      reason: input.reason,
      account_code: code,
      unit_cost: unitCost,
      total_value: totalValue,
      notes: input.notes ?? null,
      created_by: userId,
    }).select("id").single();

    // Post the journal entry.
    const desc = `${input.reason.replace("_", " ")} - ${prod.name} (${qty > 0 ? "+" : ""}${qty})`;
    if (totalValue > 0) {
      const j = qty < 0
        ? await postJournal({
            date: new Date().toISOString().slice(0, 10),
            description: desc,
            source_type: "manual",
            source_id: adj?.id ?? null,
            lines: [
              { account_code: code,    debit:  totalValue, description: desc },
              { account_code: "1300",  credit: totalValue, description: desc },
            ],
          })
        : await postJournal({
            date: new Date().toISOString().slice(0, 10),
            description: desc,
            source_type: "manual",
            source_id: adj?.id ?? null,
            lines: [
              { account_code: "1300", debit:  totalValue, description: desc },
              { account_code: code,   credit: totalValue, description: desc },
            ],
          });
      if (j.entry_id && adj?.id) {
        await admin.from("stock_adjustments").update({ journal_entry_id: j.entry_id }).eq("id", adj.id);
      }
    }

    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true, adjustment_id: adj?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function readPayload(formData: FormData) {
  return {
    code: String(formData.get("code") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    category: String(formData.get("category") || "") || null,
    sku: String(formData.get("sku") || "") || null,
    barcode: String(formData.get("barcode") || "") || null,
    unit: String(formData.get("unit") || "pcs"),
    cost_price: Number(formData.get("cost_price") || 0),
    selling_price: Number(formData.get("selling_price") || 0),
    current_stock: Number(formData.get("current_stock") || 0),
    min_stock: Number(formData.get("min_stock") || 0),
    taxable: formData.get("taxable") === "on" || formData.get("taxable") === "true",
    serial_tracked: formData.get("serial_tracked") === "on" || formData.get("serial_tracked") === "true",
    status: String(formData.get("status") || "active"),
  };
}

/**
 * Post an opening-balance or stock-delta journal so the GL matches the
 * product's new on-hand count. Inserts a stock_adjustments audit row too.
 *
 *   qtyChange > 0 :  Dr Inventory 1300  / Cr Inventory Adjustment 5700
 *   qtyChange < 0 :  Dr Inventory Adjustment 5700 / Cr Inventory 1300
 */
/**
 * One-shot reconciliation: find every opening-stock adjustment that was
 * historically posted against the wrong contra account (5700 Inventory
 * Adjustment, an expense) and reclassify it to 3000 Owner Equity.
 *
 *   Original (wrong):  Dr Inventory 1300 / Cr Inventory Adjustment 5700
 *   Correct ideal:     Dr Inventory 1300 / Cr Owner Equity 3000
 *
 * This action posts a CORRECTION journal for each affected row:
 *   Dr Inventory Adjustment 5700  (cancels the bad credit)
 *   Cr Owner Equity 3000         (adds the proper equity credit)
 *
 * After: net 5700 effect = 0, net 3000 effect = the opening contribution.
 * Idempotent — once an adjustment's account_code is flipped to 3000 it's
 * skipped on subsequent runs.
 */
export async function reconcileOpeningStockEquity(): Promise<Result & { fixed?: number; total?: number }> {
  try {
    await requirePermission("accounting", "edit");
    const admin = createServiceClient();

    // Ensure the standard chart of accounts exists (auto-creates if missing).
    await ensureChartOfAccounts(admin);

    const { data: rows } = await admin
      .from("stock_adjustments")
      .select("id, product_id, total_value, notes")
      .eq("reason", "opening_balance")
      .eq("account_code", "5700");

    if (!rows || rows.length === 0) {
      return { ok: true, fixed: 0, total: 0 };
    }

    let fixed = 0;
    let totalReclassified = 0;
    for (const r of rows) {
      const value = Number(r.total_value || 0);
      if (value <= 0) continue;

      const { data: prod } = await admin.from("products").select("name").eq("id", r.product_id).single();
      const desc = `Reclassify opening stock to equity - ${prod?.name || "(product removed)"}`;

      const j = await postJournal({
        date: new Date().toISOString().slice(0, 10),
        description: desc,
        source_type: "manual",
        source_id: r.id,
        lines: [
          { account_code: "5700", debit:  value, description: desc },
          { account_code: "3000", credit: value, description: desc },
        ],
      });
      if (!j.ok) continue;

      await admin.from("stock_adjustments").update({
        account_code: "3000",
        notes: (r.notes ? r.notes + " · " : "") + "Reclassified to Owner Equity by reconciliation",
      }).eq("id", r.id);

      fixed += 1;
      totalReclassified += value;
    }

    revalidatePath("/journal");
    revalidatePath("/reports");
    revalidatePath("/chart-of-accounts");
    return { ok: true, fixed, total: totalReclassified };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function postOpeningStockJournal(opts: {
  product_id: string;
  product_name: string;
  qty_change: number;
  unit_cost: number;
  reason: "opening_balance" | "count" | "found" | "shrinkage";
}): Promise<{ ok: boolean; error?: string }> {
  const { qty_change, unit_cost } = opts;
  if (!qty_change || qty_change === 0) return { ok: true };
  const totalValue = Math.abs(qty_change * unit_cost);
  if (totalValue <= 0) return { ok: true }; // zero-cost product; nothing to post

  const admin = createServiceClient();

  // ---------------------------------------------------------------------------
  // Pick the CONTRA account for the inventory leg.
  //
  // Opening balance (product created/imported with stock > 0):
  //   Capital contributed in kind — NOT a P&L event. Credit Opening Balance
  //   Equity (3200), the "not-yet-attributed" opening pool. Shareholders then
  //   claim their share of it via an in-kind contribution (Dr 3200 / Cr 3000),
  //   which is how opening stock flows into each owner's shares.
  //
  // Count / found / shrinkage (operational adjustments after launch):
  //   These are real P&L events — value gained or lost. Route to the Inventory
  //   Adjustment expense account (5700) per the original behaviour.
  // ---------------------------------------------------------------------------
  const isOpeningBalance = opts.reason === "opening_balance";
  const contraCode = isOpeningBalance ? "3200" : "5700";

  // Auto-create the standard chart of accounts if it isn't there yet, so a
  // freshly-provisioned shop can record opening stock without manual setup.
  await ensureChartOfAccounts(admin);

  const desc = `${opts.reason.replace("_", " ")} - ${opts.product_name} (${qty_change > 0 ? "+" : ""}${qty_change})`;
  const { data: adj } = await admin.from("stock_adjustments").insert({
    product_id: opts.product_id,
    qty_change,
    reason: opts.reason,
    account_code: contraCode,
    unit_cost,
    total_value: totalValue,
    notes: isOpeningBalance
      ? "Auto: opening stock — posted to Opening Balance Equity"
      : null,
  }).select("id").single();

  const j = qty_change > 0
    ? await postJournal({
        date: new Date().toISOString().slice(0, 10),
        description: desc,
        source_type: "manual",
        source_id: adj?.id ?? null,
        lines: [
          { account_code: "1300",     debit:  totalValue, description: desc },
          { account_code: contraCode, credit: totalValue, description: desc },
        ],
      })
    : await postJournal({
        date: new Date().toISOString().slice(0, 10),
        description: desc,
        source_type: "manual",
        source_id: adj?.id ?? null,
        lines: [
          { account_code: contraCode, debit:  totalValue, description: desc },
          { account_code: "1300",     credit: totalValue, description: desc },
        ],
      });
  if (!j.ok) {
    // Roll back the audit row so we don't leave an orphan claiming the
    // journal posted when it didn't.
    if (adj?.id) await admin.from("stock_adjustments").delete().eq("id", adj.id);
    return { ok: false, error: j.error || "Failed to post opening-stock journal" };
  }
  if (j.entry_id && adj?.id) {
    await admin.from("stock_adjustments").update({ journal_entry_id: j.entry_id }).eq("id", adj.id);
  }
  return { ok: true };
}

export async function createProduct(formData: FormData): Promise<Result> {
  try {
    await requirePermission("products", "create");
    const cfg = await getSettings();
    const payload = readPayload(formData);
    if (!payload.code) payload.code = await reserveNextNumber("nextProduct", cfg.numbering?.productPrefix || "PRD-");
    if (!payload.name) return { ok: false, error: "Name is required" };

    // Parse optional initial serials (one per line, optionally `serial|barcode`)
    const initialSerialsRaw = String(formData.get("initial_serials") || "").trim();
    const initialSerials = initialSerialsRaw
      ? initialSerialsRaw.split(/\r?\n/).map((row) => {
          const [serial, barcode] = row.split("|").map((s) => s.trim());
          return { serial, barcode: barcode || null };
        }).filter((u) => u.serial)
      : [];

    if (payload.serial_tracked && Number(payload.current_stock) > 0) {
      if (initialSerials.length === 0) {
        return {
          ok: false,
          error: `Stock is ${payload.current_stock} but no serial numbers were provided. Either set stock to 0 (and add later via Purchase Receipt) or enter one serial number per line in "Initial serials".`,
        };
      }
      if (initialSerials.length !== Number(payload.current_stock)) {
        return {
          ok: false,
          error: `You entered ${initialSerials.length} serial(s) but stock is ${payload.current_stock}. They must match.`,
        };
      }
      const seen = new Set<string>();
      for (const u of initialSerials) {
        if (seen.has(u.serial)) {
          return { ok: false, error: `Duplicate serial "${u.serial}" in the list — each unit must be unique.` };
        }
        seen.add(u.serial);
      }
    }

    const supabase = await createClient();
    const { data: created, error } = await supabase.from("products").insert(payload).select("id, name, cost_price, current_stock, serial_tracked").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed to create product" };

    // Insert inventory_units for serial-tracked products with initial serials.
    if (created.serial_tracked && initialSerials.length > 0) {
      const admin = createServiceClient();
      const unitCost = Number(created.cost_price) || 0;
      const rows = initialSerials.map((u) => ({
        product_id: created.id,
        serial_no:  u.serial,
        barcode:    u.barcode,
        status:     "in_stock",
        cost:       unitCost,
        notes:      "Initial stock when product was created",
      }));
      const { error: unitsErr } = await admin.from("inventory_units").insert(rows);
      if (unitsErr) {
        // Rollback the product so the user can retry cleanly.
        await admin.from("products").delete().eq("id", created.id);
        return { ok: false, error: `Failed to insert serials: ${unitsErr.message}` };
      }
    }

    // Opening balance journal — for any product with stock > 0 and cost > 0.
    // Dr Inventory / Cr Owner Equity so the balance sheet stays balanced.
    if (Number(created.current_stock) > 0 && Number(created.cost_price) > 0) {
      const j = await postOpeningStockJournal({
        product_id: created.id,
        product_name: created.name,
        qty_change: Number(created.current_stock),
        unit_cost: Number(created.cost_price),
        reason: "opening_balance",
      });
      if (!j.ok) {
        // Roll back the product so the user can fix the chart-of-accounts
        // gap (or whatever else broke) and try again — instead of leaving
        // inventory with no offsetting credit.
        const adminClient = createServiceClient();
        await adminClient.from("products").delete().eq("id", created.id);
        return { ok: false, error: `Opening stock journal failed: ${j.error}` };
      }
    }

    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/journal");
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateProduct(id: string, formData: FormData): Promise<Result> {
  try {
    await requirePermission("products", "edit");
    const payload = readPayload(formData);
    if (!payload.name || !payload.code) return { ok: false, error: "Code and name required" };

    const admin = createServiceClient();
    const { data: existing } = await admin
      .from("products")
      .select("id, name, cost_price, current_stock, serial_tracked")
      .eq("id", id)
      .single();
    if (!existing) return { ok: false, error: "Product not found" };

    const oldStock = Number(existing.current_stock || 0);
    const newStock = Number(payload.current_stock || 0);
    const delta = newStock - oldStock;

    // Serial-tracked products: manual stock changes are not allowed.
    // Force the new stock to equal the old stock for serial-tracked items.
    if (existing.serial_tracked && delta !== 0) {
      return {
        ok: false,
        error: "Stock for serial-tracked products can only change via Purchase Receipt or Adjust Stock (with serials). Leave the stock number unchanged.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("products").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };

    // Non-serial: if the count changed, post a balancing journal.
    if (!existing.serial_tracked && delta !== 0) {
      const j = await postOpeningStockJournal({
        product_id: id,
        product_name: payload.name,
        qty_change: delta,
        unit_cost: Number(payload.cost_price) || Number(existing.cost_price) || 0,
        reason: "count",
      });
      if (!j.ok) {
        return { ok: false, error: `Stock-change journal failed: ${j.error}` };
      }
    }

    revalidatePath("/products");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteProduct(id: string): Promise<Result> {
  try {
    await requirePermission("products", "delete");
    const supabase = await createClient();
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkDeleteProducts(ids: string[]) {
  try {
    await requirePermission("products", "delete");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const supabase = await createClient();
    const { error } = await supabase.from("products").delete().in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/products");
    return { ok: true, message: `${ids.length} product(s) deleted` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bulkSetProductStatus(ids: string[], status: "active" | "inactive") {
  try {
    await requirePermission("products", "edit");
    if (!ids.length) return { ok: false, error: "Nothing selected" };
    const supabase = await createClient();
    const { error } = await supabase.from("products").update({ status }).in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/products");
    return { ok: true, message: `${ids.length} product(s) set ${status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function importProducts(rows: Record<string, string>[]) {
  try {
    await requirePermission("products", "create");
    const supabase = await createClient();
    const cfg = await getSettings();
    const records: Record<string, unknown>[] = [];
    for (const row of rows) {
      const get = (k: string) => row[k] ?? row[k.toLowerCase()] ?? "";
      const name = String(get("Name")).trim();
      if (!name) continue;
      let code = String(get("Code")).trim();
      if (!code) code = await reserveNextNumber("nextProduct", cfg.numbering?.productPrefix || "PRD-");

      const isSerialTracked = ["1","true","yes","y"].includes(String(get("Serial Tracked")).toLowerCase());
      const isTaxable       = !["0","false","no","n"].includes(String(get("Taxable")).toLowerCase()); // default true
      const stock           = Number(get("Stock") || 0);

      // Refuse to import a serial-tracked product with non-zero stock — there
      // would be no serial captured. The user must add stock via a Purchase
      // Receipt (which captures serials) after import completes.
      if (isSerialTracked && stock !== 0) {
        return { ok: false, error: `Row "${name}" is serial-tracked; stock must be 0 in CSV. Add units later via a Purchase Receipt.` };
      }

      records.push({
        code, name,
        category: String(get("Category")) || null,
        sku: String(get("SKU")) || null,
        barcode: String(get("Barcode")) || null,
        unit: String(get("Unit")) || "pcs",
        cost_price: Number(get("Cost") || get("Cost Price") || 0),
        selling_price: Number(get("Sell Price") || get("Selling Price") || 0),
        current_stock: stock,
        min_stock: Number(get("Min Stock") || 0),
        taxable: isTaxable,
        serial_tracked: isSerialTracked,
        status: String(get("Status")).toLowerCase() === "inactive" ? "inactive" : "active",
      });
    }
    if (!records.length) return { ok: false, error: "No valid rows" };

    // Insert, return the inserted rows so we can post opening journals.
    const { data: inserted, error } = await supabase
      .from("products")
      .insert(records)
      .select("id, name, cost_price, current_stock, serial_tracked");
    if (error) return { ok: false, error: error.message };

    // Post opening-balance journals per row (Dr Inventory / Cr Owner Equity).
    let postedCount = 0, postedValue = 0;
    const failed: { name: string; error: string }[] = [];
    for (const p of inserted || []) {
      if (!p.serial_tracked && Number(p.current_stock) > 0 && Number(p.cost_price) > 0) {
        const j = await postOpeningStockJournal({
          product_id: p.id,
          product_name: p.name,
          qty_change: Number(p.current_stock),
          unit_cost: Number(p.cost_price),
          reason: "opening_balance",
        });
        if (j.ok) {
          postedCount += 1;
          postedValue += Number(p.current_stock) * Number(p.cost_price);
        } else {
          failed.push({ name: p.name, error: j.error || "unknown" });
        }
      }
    }
    if (failed.length > 0) {
      // Don't silently swallow — tell the user which rows didn't post so they
      // can fix the chart of accounts and re-import (or post manually).
      return {
        ok: false,
        error: `Imported ${inserted?.length || 0} product(s) but ${failed.length} opening journal(s) failed: ` +
               failed.map((f) => `${f.name} (${f.error})`).join("; "),
      };
    }
    revalidatePath("/products");
    revalidatePath("/dashboard");
    revalidatePath("/journal");
    revalidatePath("/reports");
    const journalNote = postedCount > 0
      ? ` · posted ${postedCount} opening journal(s) worth ${postedValue.toFixed(2)}`
      : "";
    return { ok: true, inserted: (inserted?.length ?? records.length), failed: rows.length - records.length, note: journalNote };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function exportProducts(q?: string, status?: string, category?: string) {
  try {
    await requirePermission("products", "view");
    const supabase = await createClient();
    let query = supabase.from("products").select("*").order("created_at", { ascending: false });
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,sku.ilike.%${q}%`);
    if (status) query = query.eq("status", status);
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) return { ok: false, error: error.message };
    const csv = objectsToCsv(data || [], [
      { key: "code", header: "Code" },
      { key: "name", header: "Name" },
      { key: "category", header: "Category" },
      { key: "sku", header: "SKU" },
      { key: "barcode", header: "Barcode" },
      { key: "unit", header: "Unit" },
      { key: "cost_price", header: "Cost" },
      { key: "selling_price", header: "Sell Price" },
      { key: "current_stock", header: "Stock" },
      { key: "min_stock", header: "Min Stock" },
      { key: "status", header: "Status" },
    ]);
    return { ok: true, csv, filename: `products-${new Date().toISOString().slice(0, 10)}.csv` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
