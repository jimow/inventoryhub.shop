import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Package, ShoppingCart, Receipt as ReceiptIcon, Sliders, Box, Undo2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { requireViewPermission, getCurrentSession } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatDate } from "@/lib/utils";
import type { Product, Sale, Purchase } from "@/lib/types";

type SP = Promise<{ from?: string; to?: string; type?: string; dir?: string }>;

type TimelineRow = {
  ts: string;
  kind: "purchase" | "sale" | "purchase_return" | "sale_return" | "adjustment" | "opening";
  doc: string;
  detail: string;
  qty: number;          // positive = stock in, negative = stock out
  value: number;        // qty * unit_price/cost
  status?: string;
  url?: string;
  party?: string;       // customer (sale) or supplier (purchase) name
  partyUrl?: string;    // link to that customer/supplier
};

export default async function ProductDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: SP;
}) {
  await requireViewPermission("products");
  await getCurrentSession();
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("*").eq("id", id).single();
  if (!product) notFound();
  const p = product as Product;

  // Fetch everything that touches this product.
  const [
    { data: purchases },
    { data: sales },
    { data: adjustments },
    { data: units },
    { data: customers },
    { data: suppliers },
    { data: salesReturns },
    { data: purchaseReturns },
    { data: transfers },
  ] = await Promise.all([
    supabase.from("purchases").select("id, po_no, date, items, status, total, supplier_id"),
    supabase.from("sales").select("id, invoice_no, date, items, status, total, customer_id"),
    supabase.from("stock_adjustments").select("*").eq("product_id", id).order("created_at", { ascending: false }),
    supabase.from("inventory_units").select("id, serial_no, barcode, status, location, cost, purchase_id, sale_id, created_at, updated_at")
      .eq("product_id", id).order("created_at", { ascending: false }),
    supabase.from("customers").select("id, name"),
    supabase.from("suppliers").select("id, name"),
    supabase.from("sales_returns").select("return_no, date, items, status, customer_id"),
    supabase.from("purchase_returns").select("return_no, date, items, status, supplier_id"),
    supabase.from("stock_transfers").select("id, transfer_no, qty, direction, date, reference, charge, serials, notes, created_at").eq("product_id", id).order("created_at", { ascending: false }),
  ]);
  type Transfer = {
    id: string; transfer_no: string | null; qty: number; direction: "to_shop" | "to_store";
    date: string; reference: string | null; charge: number | null;
    serials: { unit_id: string; serial_no: string }[] | null; notes: string | null; created_at: string;
  };
  const transferRows = (transfers as Transfer[]) || [];
  const customerName = new Map((customers || []).map((c) => [c.id as string, c.name as string]));
  const supplierName = new Map((suppliers || []).map((s) => [s.id as string, s.name as string]));

  // Build the activity timeline.
  const rows: TimelineRow[] = [];

  for (const po of (purchases || []) as Purchase[]) {
    if (po.status === "cancelled") continue;
    const lines = (po.items || []).filter((l) => l.refId === id);
    for (const l of lines) {
      rows.push({
        ts: po.date,
        kind: "purchase",
        doc: po.po_no,
        detail: `Received ${l.qty} × ${formatMoney(l.price)}`,
        qty: Number(l.qty),
        value: Number(l.qty) * Number(l.price),
        status: po.status,
        url: `/purchases?q=${encodeURIComponent(po.po_no)}`,
        party: po.supplier_id ? (supplierName.get(po.supplier_id) || "Supplier") : undefined,
        partyUrl: po.supplier_id ? `/suppliers/${po.supplier_id}` : undefined,
      });
    }
  }

  for (const s of (sales || []) as Sale[]) {
    if (s.status === "cancelled" || s.status === "draft") continue;
    const lines = (s.items || []).filter((l) => l.refId === id);
    for (const l of lines) {
      rows.push({
        ts: s.date,
        kind: "sale",
        doc: s.invoice_no,
        detail: `Sold ${l.qty} × ${formatMoney(l.price)}`,
        qty: -Number(l.qty),
        value: Number(l.qty) * Number(l.price),
        status: s.status,
        url: `/sales?q=${encodeURIComponent(s.invoice_no)}`,
        party: s.customer_id ? (customerName.get(s.customer_id) || "Customer") : "Walk-in",
        partyUrl: s.customer_id ? `/customers/${s.customer_id}` : undefined,
      });
    }
  }

  // Customer returns goods → stock IN.
  type Ret = { return_no: string | null; date: string; items: { refId: string; name: string; qty: number; price: number }[]; status: string; customer_id?: string | null; supplier_id?: string | null };
  for (const sr of (salesReturns || []) as Ret[]) {
    if (sr.status === "cancelled") continue;
    for (const l of (sr.items || []).filter((l) => l.refId === id)) {
      rows.push({
        ts: sr.date,
        kind: "sale_return",
        doc: sr.return_no || "Return",
        detail: `Customer returned ${l.qty} × ${formatMoney(l.price)}`,
        qty: Number(l.qty),
        value: Number(l.qty) * Number(l.price),
        url: `/returns`,
        party: sr.customer_id ? (customerName.get(sr.customer_id) || "Customer") : "Walk-in",
        partyUrl: sr.customer_id ? `/customers/${sr.customer_id}` : undefined,
      });
    }
  }

  // We return goods to a supplier → stock OUT.
  for (const pr of (purchaseReturns || []) as Ret[]) {
    if (pr.status === "cancelled") continue;
    for (const l of (pr.items || []).filter((l) => l.refId === id)) {
      rows.push({
        ts: pr.date,
        kind: "purchase_return",
        doc: pr.return_no || "Return",
        detail: `Returned ${l.qty} × ${formatMoney(l.price)} to supplier`,
        qty: -Number(l.qty),
        value: Number(l.qty) * Number(l.price),
        url: `/returns`,
        party: pr.supplier_id ? (supplierName.get(pr.supplier_id) || "Supplier") : undefined,
        partyUrl: pr.supplier_id ? `/suppliers/${pr.supplier_id}` : undefined,
      });
    }
  }

  type Adj = { id: string; qty_change: number; reason: string; total_value: number; created_at: string; notes: string | null };
  for (const a of (adjustments || []) as Adj[]) {
    rows.push({
      ts: a.created_at.slice(0, 10),
      kind: a.reason === "opening_balance" ? "opening" : "adjustment",
      doc: a.reason.replace("_", " "),
      detail: a.notes || `${a.qty_change > 0 ? "+" : ""}${a.qty_change}`,
      qty: Number(a.qty_change),
      value: Number(a.total_value),
    });
  }

  // Classic stock card: default the range from the product's creation date to
  // today, show an opening balance, then movements oldest→newest with a running
  // balance after each line.
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = sp.from || (p.created_at ? String(p.created_at).slice(0, 10) : "");
  const toDate = sp.to || today;

  // Opening balance = net of every movement strictly before the range start.
  const opening = fromDate
    ? rows.filter((r) => r.ts < fromDate).reduce((s, r) => s + r.qty, 0)
    : 0;

  // Movements within range, oldest first, with a running balance.
  const filtered = rows
    .filter((r) => {
      if (fromDate && r.ts < fromDate) return false;
      if (toDate && r.ts > toDate) return false;
      if (sp.type && r.kind !== sp.type) return false;
      if (sp.dir === "in" && r.qty <= 0) return false;
      if (sp.dir === "out" && r.qty >= 0) return false;
      return true;
    })
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.kind.localeCompare(b.kind));

  let runBal = opening;
  const ledger = filtered.map((r) => { runBal += r.qty; return { ...r, balance: runBal }; });
  const closing = runBal;

  // Aggregates (over filtered rows, so the stat cards respect the date filter)
  const purchasedQty = filtered.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.qty, 0);
  const soldQty      = -filtered.filter((r) => r.kind === "sale").reduce((s, r) => s + r.qty, 0);
  const adjQty       = filtered.filter((r) => r.kind === "adjustment" || r.kind === "opening").reduce((s, r) => s + r.qty, 0);
  const returnedInQty  = filtered.filter((r) => r.kind === "sale_return").reduce((s, r) => s + r.qty, 0);
  const returnedOutQty = -filtered.filter((r) => r.kind === "purchase_return").reduce((s, r) => s + r.qty, 0);
  const purchasedVal = filtered.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.value, 0);
  const soldVal      = filtered.filter((r) => r.kind === "sale").reduce((s, r) => s + r.value, 0);

  const unitsInStock = (units || []).filter((u) => u.status === "in_stock").length;
  const unitsSold    = (units || []).filter((u) => u.status === "sold").length;
  const shopStock    = Number(p.current_stock) || 0;
  const storeStock   = Number(p.store_stock) || 0;
  const totalOnHand  = shopStock + storeStock;
  const stockValue   = totalOnHand * Number(p.cost_price);

  return (
    <div>
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
        <ArrowLeft className="h-4 w-4" /> All products
      </Link>
      <PageHeader title={p.name} description={`${p.code} · ${p.category || "Uncategorised"}`}>
        <Badge variant={p.status === "active" ? "success" : "secondary"}>{p.status}</Badge>
        {p.serial_tracked && <Badge variant="info">Serial-tracked</Badge>}
        {p.taxable === false && <Badge variant="warning">Tax-exempt</Badge>}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="On hand"     value={`${totalOnHand} ${p.unit}`} sub={`Shop ${shopStock} · Store ${storeStock}`} icon={Box} color="bg-blue-500" />
        <Stat label="Stock value" value={formatMoney(stockValue)}        icon={Package}        color="bg-emerald-500" />
        <Stat label="Sold (range)" value={`${soldQty} ${p.unit}`}        icon={ReceiptIcon}    color="bg-cyan-500" />
        <Stat label="Purchased (range)" value={`${purchasedQty} ${p.unit}`} icon={ShoppingCart} color="bg-amber-500" />
      </div>

      {/* Headline numbers + adjustments */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Sales revenue (range)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{formatMoney(soldVal)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Cost of purchases (range)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{formatMoney(purchasedVal)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Returns (range)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            <span className="text-emerald-700">+{returnedInQty}</span>
            <span className="text-slate-400 mx-1">/</span>
            <span className="text-amber-700">-{returnedOutQty}</span>
          </div>
          <div className="text-[11px] text-slate-500">in (sales returns) · out (purchase returns) · adj {adjQty > 0 ? `+${adjQty}` : adjQty}</div>
        </CardContent></Card>
      </div>

      {/* Filter form (GET so it shows in URL) */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <form className="grid grid-cols-12 gap-3 items-end" action="">
            <div className="col-span-6 sm:col-span-3">
              <label className="text-xs text-slate-500">From (created {p.created_at ? formatDate(String(p.created_at).slice(0, 10)) : "—"})</label>
              <Input type="date" name="from" defaultValue={fromDate} />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className="text-xs text-slate-500">To</label>
              <Input type="date" name="to" defaultValue={toDate} />
            </div>
            <div className="col-span-6 sm:col-span-2">
              <label className="text-xs text-slate-500">Type</label>
              <select name="type" defaultValue={sp.type || ""} className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm">
                <option value="">All types</option>
                <option value="purchase">Purchases</option>
                <option value="sale">Sales</option>
                <option value="sale_return">Sales returns</option>
                <option value="purchase_return">Purchase returns</option>
                <option value="adjustment">Adjustments</option>
                <option value="opening">Opening balances</option>
              </select>
            </div>
            <div className="col-span-6 sm:col-span-2">
              <label className="text-xs text-slate-500">Direction</label>
              <select name="dir" defaultValue={sp.dir || ""} className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm">
                <option value="">All</option>
                <option value="in">Stock in</option>
                <option value="out">Stock out</option>
              </select>
            </div>
            <div className="col-span-12 sm:col-span-2 flex gap-2">
              <Button type="submit" size="sm">Filter</Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href={`/products/${id}`}>Reset</Link>
              </Button>
            </div>
            <div className="col-span-12 flex flex-wrap gap-1.5 pt-1">
              {([
                ["This month", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)],
                ["This year", `${new Date().getFullYear()}-01-01`],
                ["All time", p.created_at ? String(p.created_at).slice(0, 10) : ""],
              ] as const).map(([label, f]) => (
                <Link key={label} href={`/products/${id}?from=${f}&to=${today}${sp.type ? `&type=${sp.type}` : ""}${sp.dir ? `&dir=${sp.dir}` : ""}`}
                  className="text-[11px] px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
                  {label}
                </Link>
              ))}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Stock card — chronological, with a running balance (classic ledger) */}
      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold text-slate-900">Stock Card</div>
          <div className="text-xs text-slate-500">
            {fromDate ? formatDate(fromDate) : "start"} → {formatDate(toDate)} · {filtered.length} movement(s)
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Document</th>
                <th className="text-left p-3">Customer / Supplier</th>
                <th className="text-left p-3">Detail</th>
                <th className="text-right p-3">In</th>
                <th className="text-right p-3">Out</th>
                <th className="text-right p-3">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t bg-slate-50/60">
                <td className="p-3 text-slate-500" colSpan={5}>Opening balance{fromDate ? ` (as at ${formatDate(fromDate)})` : ""}</td>
                <td className="p-3" />
                <td className="p-3" />
                <td className="p-3 text-right font-semibold tabular-nums">{opening} {p.unit}</td>
              </tr>
              {ledger.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-3 whitespace-nowrap">{formatDate(r.ts)}</td>
                  <td className="p-3"><KindBadge kind={r.kind} /></td>
                  <td className="p-3 font-mono">
                    {r.url ? <Link href={r.url} className="text-blue-600 hover:underline">{r.doc}</Link> : r.doc}
                  </td>
                  <td className="p-3">
                    {r.party
                      ? (r.partyUrl
                          ? <Link href={r.partyUrl} className="text-blue-600 hover:underline">{r.party}</Link>
                          : <span className="text-slate-600">{r.party}</span>)
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="p-3 text-slate-600">{r.detail}</td>
                  <td className="p-3 text-right text-emerald-700 font-medium tabular-nums">{r.qty > 0 ? r.qty : ""}</td>
                  <td className="p-3 text-right text-amber-700 font-medium tabular-nums">{r.qty < 0 ? -r.qty : ""}</td>
                  <td className="p-3 text-right font-semibold tabular-nums">{r.balance}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td className="p-3" colSpan={5}>Closing balance (as at {formatDate(toDate)})</td>
                <td className="p-3" />
                <td className="p-3" />
                <td className="p-3 text-right tabular-nums">{closing} {p.unit}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Store ↔ Shop transfers for this product */}
      {transferRows.length > 0 && (
        <Card className="mt-4">
          <div className="p-4 border-b">
            <div className="font-semibold text-slate-900">Store ↔ Shop transfers</div>
            <div className="text-xs text-slate-500 mt-0.5">Movements between the warehouse and the sales floor (don&apos;t change total on hand)</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left p-3">Doc / Date</th>
                  <th className="text-left p-3">Direction</th>
                  <th className="text-right p-3">Qty</th>
                  <th className="text-right p-3">Charge</th>
                  <th className="text-left p-3">Serials / Notes</th>
                </tr>
              </thead>
              <tbody>
                {transferRows.map((t) => (
                  <tr key={t.id} className="border-t align-top">
                    <td className="p-3 whitespace-nowrap">
                      <div className="font-mono text-xs text-slate-700">{t.transfer_no || "—"}</div>
                      <div className="text-xs text-slate-400">{formatDate(t.date)}</div>
                      {t.reference && <div className="text-[11px] text-slate-400">Ref: {t.reference}</div>}
                    </td>
                    <td className="p-3">
                      {t.direction === "to_shop"
                        ? <Badge variant="success">Store → Shop</Badge>
                        : <Badge variant="warning">Shop → Store</Badge>}
                    </td>
                    <td className="p-3 text-right tabular-nums font-medium">{Number(t.qty).toLocaleString()} {p.unit}</td>
                    <td className="p-3 text-right tabular-nums">{Number(t.charge || 0) > 0 ? formatMoney(Number(t.charge)) : <span className="text-slate-300">—</span>}</td>
                    <td className="p-3 text-slate-600">
                      {Array.isArray(t.serials) && t.serials.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {t.serials.map((s) => <span key={s.unit_id} className="font-mono text-[10px] bg-slate-100 rounded px-1.5 py-0.5">{s.serial_no}</span>)}
                        </div>
                      )}
                      {t.notes || (!t.serials?.length && <span className="text-slate-300">—</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Serial units table (if serial-tracked) */}
      {p.serial_tracked && (units?.length ?? 0) > 0 && (
        <Card className="mt-4">
          <div className="p-4 border-b">
            <div className="font-semibold text-slate-900">Serial units</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {unitsInStock} in stock · {unitsSold} sold · {(units || []).length} total tracked
            </div>
          </div>
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left p-3">Serial</th>
                  <th className="text-left p-3">Barcode</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Location</th>
                  <th className="text-right p-3">Cost</th>
                  <th className="text-left p-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {(units || []).map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="p-3 font-mono">{u.serial_no}</td>
                    <td className="p-3 font-mono text-slate-500">{u.barcode || "-"}</td>
                    <td className="p-3">
                      <Badge variant={u.status === "in_stock" ? "success" : u.status === "sold" ? "info" : "secondary"}>{u.status}</Badge>
                    </td>
                    <td className="p-3">
                      {u.status === "in_stock"
                        ? <Badge variant={(u as { location?: string }).location === "store" ? "warning" : "secondary"}>{(u as { location?: string }).location === "store" ? "Store" : "Shop"}</Badge>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="p-3 text-right">{formatMoney(u.cost)}</td>
                    <td className="p-3">{formatDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-lg font-bold text-slate-900">{value}</div>
          {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function KindBadge({ kind }: { kind: TimelineRow["kind"] }) {
  switch (kind) {
    case "purchase":        return <Badge variant="warning" className="inline-flex items-center gap-1"><ShoppingCart className="h-3 w-3" />Purchase</Badge>;
    case "sale":            return <Badge variant="info"    className="inline-flex items-center gap-1"><ReceiptIcon className="h-3 w-3" />Sale</Badge>;
    case "sale_return":     return <Badge variant="success" className="inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />Sale return</Badge>;
    case "purchase_return": return <Badge variant="danger"  className="inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />Purchase return</Badge>;
    case "adjustment":      return <Badge variant="secondary" className="inline-flex items-center gap-1"><Sliders className="h-3 w-3" />Adjustment</Badge>;
    case "opening":         return <Badge variant="success" className="inline-flex items-center gap-1"><Box className="h-3 w-3" />Opening</Badge>;
  }
}
