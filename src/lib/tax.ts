// Server-only helper that computes sale / purchase totals while respecting
// the `taxable` flag on each line's underlying product or item.
//
// Tax base = sum(qty * price) over lines whose product/item is taxable.
// Discount (flat amount) is pro-rated against the taxable portion so an
// untaxable line never reduces the tax base.

import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

export type TotalsLine = { refId: string; qty: number; price: number };
export type Totals = { subtotal: number; discount: number; taxBase: number; tax: number; total: number };

async function taxableMap(refIds: string[], table: "products" | "items"): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  if (!refIds.length) return m;
  const admin = createServiceClient();
  const { data } = await admin.from(table).select("id, taxable").in("id", refIds);
  for (const row of (data || []) as { id: string; taxable: boolean | null }[]) {
    m.set(row.id, row.taxable !== false);
  }
  return m;
}

export async function computeTotals(
  lines: TotalsLine[],
  discount: number,
  taxRate: number,
  source: "sales" | "purchases" = "sales",
  inclusive: boolean = false,
): Promise<Totals> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const table: "products" | "items" = source === "sales" ? "products" : "items";
  const refIds = Array.from(new Set(lines.map((l) => l.refId)));
  const tmap = await taxableMap(refIds, table);

  let subtotal = 0;
  let taxableSub = 0;
  for (const l of lines) {
    const lineTotal = Number(l.qty) * Number(l.price);
    subtotal += lineTotal;
    if (tmap.get(l.refId) !== false) taxableSub += lineTotal;
  }
  const disc = Math.max(0, Number(discount) || 0);
  const taxablePortion = subtotal > 0 ? taxableSub / subtotal : 0;
  const taxableAfterDisc = Math.max(0, taxableSub - disc * taxablePortion);
  const rate = Number(taxRate) || 0;

  if (inclusive) {
    // Line prices already include tax. Back out the tax portion of the
    // taxable-line gross. Total = gross net of discount (= what user pays).
    const taxableNet = rate > 0 ? taxableAfterDisc / (1 + rate / 100) : taxableAfterDisc;
    const tax = taxableAfterDisc - taxableNet;
    const total = r2(subtotal - disc);
    return {
      subtotal: r2(subtotal),
      discount: disc,
      taxBase: r2(taxableNet),
      tax: r2(tax),
      total,
    };
  }

  // Exclusive: tax added on top of taxable base.
  const tax = (taxableAfterDisc * rate) / 100;
  const total = r2(subtotal - disc + tax);
  return {
    subtotal: r2(subtotal),
    discount: disc,
    taxBase: r2(taxableAfterDisc),
    tax: r2(tax),
    total,
  };
}
