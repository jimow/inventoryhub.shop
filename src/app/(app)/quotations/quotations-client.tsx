"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, Pencil, Trash2, Loader2, Search, X, FileText, ArrowRightLeft, Send, Check, Ban, Printer,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";

import type { Quotation, QuotationLine, QuotationStatus, Customer, Product, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { computeLineTotals, formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import {
  createQuotation, updateQuotation, deleteQuotation, setQuotationStatus, convertQuotationToSale,
} from "./actions";

const STATUS_BADGE: Record<QuotationStatus, "secondary" | "info" | "success" | "warning" | "danger"> = {
  draft: "secondary", sent: "info", accepted: "success", converted: "success", rejected: "danger", expired: "warning",
};

export function QuotationsClient({
  quotations, totalCount, customers, products, settings, permissions,
}: {
  quotations: Quotation[];
  totalCount: number;
  customers: Customer[];
  products: Product[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const router = useRouter();
  const sym = currencySymbol(settings);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [adding, setAdding] = useState(false);

  const canCreate = can(permissions, "quotations", "create");
  const canEdit = can(permissions, "quotations", "edit");
  const canDelete = can(permissions, "quotations", "delete");

  const custById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const columns: Column<Quotation>[] = [
    { key: "quote_no", label: "Quote #", className: "w-[130px]",
      render: (r) => <span className="font-mono text-sm font-medium">{r.quote_no}</span> },
    { key: "date", label: "Date", className: "w-[110px]",
      render: (r) => <span className="text-sm text-slate-600">{formatDate(r.date)}</span> },
    { key: "customer", label: "Customer",
      render: (r) => custById.get(r.customer_id || "")?.name || <span className="text-slate-400">—</span> },
    { key: "valid_until", label: "Valid until", className: "w-[110px]",
      render: (r) => r.valid_until ? <span className="text-sm text-slate-600">{formatDate(r.valid_until)}</span> : <span className="text-slate-300">—</span> },
    { key: "total", label: "Total", className: "w-[130px] text-right",
      render: (r) => <span className="tabular-nums font-medium">{formatMoney(r.total, sym)}</span> },
    { key: "status", label: "Status", className: "w-[120px]",
      render: (r) => (
        <div className="flex items-center gap-1">
          <Badge variant={STATUS_BADGE[r.status]}>{r.status}</Badge>
          {r.status === "converted" && r.converted_sale_id && (
            <Link href={`/sales?q=`} className="text-xs text-blue-600 hover:underline">sale</Link>
          )}
        </div>
      ) },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: [
      { value: "draft", label: "Draft" }, { value: "sent", label: "Sent" },
      { value: "accepted", label: "Accepted" }, { value: "converted", label: "Converted" },
      { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" },
    ] },
    { key: "customer_id", label: "Customer", options: customers.map((c) => ({ value: c.id, label: c.name })) },
  ];

  return (
    <div>
      <PageHeader title="Quotations" description="Price quotes for customers — convert accepted ones into sales">
        {canCreate && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Quotation
          </Button>
        )}
      </PageHeader>

      <DataTable<Quotation>
        columns={columns}
        data={quotations}
        totalCount={totalCount}
        searchPlaceholder="Search by quote #..."
        filters={filters}
        expandable={{ render: (r) => <QuoteLines q={r} sym={sym} /> }}
        rowActions={(row) => (
          <QuoteActions
            q={row} canEdit={canEdit} canDelete={canDelete}
            onEdit={() => setEditing(row)}
            onChanged={() => router.refresh()}
          />
        )}
      />

      {(adding || editing) && (
        <QuotationEditor
          quote={editing}
          customers={customers}
          products={products}
          settings={settings}
          onClose={() => { setAdding(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function QuoteLines({ q, sym }: { q: Quotation; sym: string }) {
  return (
    <div className="text-sm">
      <table className="w-full">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="text-left py-1">Item</th><th className="text-right py-1 w-20">Qty</th><th className="text-right py-1 w-28">Price</th><th className="text-right py-1 w-28">Amount</th></tr>
        </thead>
        <tbody>
          {(q.items || []).map((l, i) => (
            <tr key={i} className="border-t">
              <td className="py-1.5">{l.name}{l.taxable === false && <span className="ml-2 text-[10px] text-slate-400">(non-taxable)</span>}</td>
              <td className="py-1.5 text-right tabular-nums">{l.qty}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(l.price, sym)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(l.qty) * Number(l.price), sym)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-col items-end gap-0.5 text-xs text-slate-600">
        <div>Subtotal: <span className="tabular-nums">{formatMoney(q.subtotal, sym)}</span></div>
        {Number(q.discount) > 0 && <div>Discount: <span className="tabular-nums">−{formatMoney(q.discount, sym)}</span></div>}
        <div>Tax: <span className="tabular-nums">{formatMoney(q.tax, sym)}</span></div>
        <div className="font-semibold text-slate-900">Total: <span className="tabular-nums">{formatMoney(q.total, sym)}</span></div>
        {q.notes && <div className="mt-1 italic text-slate-500 max-w-md text-right">{q.notes}</div>}
      </div>
    </div>
  );
}

function QuoteActions({
  q, canEdit, canDelete, onEdit, onChanged,
}: {
  q: Quotation; canEdit: boolean; canDelete: boolean;
  onEdit: () => void; onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const locked = q.status === "converted";

  function run(fn: () => Promise<{ ok: boolean; error?: string; sale_id?: string }>, okMsg: string, goSale?: boolean) {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(okMsg);
      if (goSale && r.sale_id) { router.push(`/sales`); return; }
      onChanged();
    });
  }

  return (
    <div className="inline-flex gap-1">
      <Button variant="ghost" size="icon" title="Print" onClick={() => printQuote(q)}><Printer className="h-4 w-4" /></Button>
      {canEdit && !locked && q.status === "draft" && (
        <Button variant="ghost" size="icon" title="Mark sent" disabled={pending}
          onClick={() => run(() => setQuotationStatus(q.id, "sent"), "Marked sent")}><Send className="h-4 w-4" /></Button>
      )}
      {canEdit && !locked && (q.status === "sent" || q.status === "draft") && (
        <Button variant="ghost" size="icon" title="Mark accepted" disabled={pending} className="text-emerald-600"
          onClick={() => run(() => setQuotationStatus(q.id, "accepted"), "Marked accepted")}><Check className="h-4 w-4" /></Button>
      )}
      {canEdit && !locked && (
        <Button variant="ghost" size="icon" title="Convert to sale" disabled={pending} className="text-blue-600"
          onClick={() => {
            if (!confirm(`Convert ${q.quote_no} into a draft sale? You can then confirm it to affect stock & accounts.`)) return;
            run(() => convertQuotationToSale(q.id), "Converted to a draft sale", true);
          }}><ArrowRightLeft className="h-4 w-4" /></Button>
      )}
      {canEdit && !locked && (
        <Button variant="ghost" size="icon" title="Edit" disabled={pending} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
      )}
      {canEdit && !locked && q.status !== "rejected" && (
        <Button variant="ghost" size="icon" title="Reject" disabled={pending} className="text-amber-600"
          onClick={() => run(() => setQuotationStatus(q.id, "rejected"), "Marked rejected")}><Ban className="h-4 w-4" /></Button>
      )}
      {canDelete && (
        <Button variant="ghost" size="icon" title="Delete" disabled={pending} className="text-red-500"
          onClick={() => {
            if (!confirm(`Delete quotation ${q.quote_no}?`)) return;
            run(() => deleteQuotation(q.id), "Deleted");
          }}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */
type EditLine = QuotationLine;

function QuotationEditor({
  quote, customers, products, settings, onClose,
}: {
  quote: Quotation | null;
  customers: Customer[];
  products: Product[];
  settings: SettingsData;
  onClose: () => void;
}) {
  const router = useRouter();
  const sym = currencySymbol(settings);
  const taxInclusive = !!settings.tax?.inclusive;
  const taxRate = Number(settings.tax?.defaultRate ?? 0);
  const taxName = settings.tax?.name || "VAT";

  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(quote?.customer_id || customers[0]?.id || "");
  const [date, setDate] = useState(quote?.date || new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(quote?.valid_until || "");
  const [notes, setNotes] = useState(quote?.notes || "");
  const [discount, setDiscount] = useState(Number(quote?.discount ?? 0));
  const [lines, setLines] = useState<EditLine[]>(quote?.items?.length ? quote.items.map((l) => ({ ...l })) : []);
  const [search, setSearch] = useState("");

  const prodById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q)
    ).slice(0, 8);
  }, [search, products]);

  function addProduct(p: Product) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.refId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Number(next[idx].qty) + 1 };
        return next;
      }
      return [...prev, {
        refId: p.id, name: p.name, qty: 1,
        price: Number(p.selling_price) || 0,
        taxable: p.taxable !== false,
      }];
    });
    setSearch("");
  }

  function setLine(i: number, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totals = useMemo(
    () => computeLineTotals(
      lines.map((l) => ({ qty: l.qty, price: l.price, taxable: prodById.get(l.refId)?.taxable !== false })),
      discount, taxRate, taxInclusive,
    ),
    [lines, discount, taxRate, taxInclusive, prodById],
  );

  function submit() {
    if (!customerId) { toast.error("Select a customer"); return; }
    const filled = lines.filter((l) => Number(l.qty) > 0);
    if (!filled.length) { toast.error("Add at least one line"); return; }
    // Resolve taxable from the live product at submit time (single source).
    const withTaxable = filled.map((l) => ({ ...l, taxable: prodById.get(l.refId)?.taxable !== false }));
    const fd = new FormData();
    fd.set("customer_id", customerId);
    fd.set("date", date);
    if (validUntil) fd.set("valid_until", validUntil);
    fd.set("discount", String(discount));
    fd.set("notes", notes);
    fd.set("items", JSON.stringify(withTaxable));
    start(async () => {
      const r = quote ? await updateQuotation(quote.id, fd) : await createQuotation(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(quote ? "Quotation updated" : "Quotation created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{quote ? `Edit ${quote.quote_no}` : "New Quotation"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-5">
            <Label>Customer *</Label>
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label htmlFor="q_date">Date</Label>
            <Input id="q_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="col-span-6 sm:col-span-4">
            <Label htmlFor="q_valid">Valid until</Label>
            <Input id="q_valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>

          {/* Product picker */}
          <div className="col-span-12 relative">
            <Label>Add item</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product by name or code..." className="pl-8" />
            </div>
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg max-h-64 overflow-auto">
                {matches.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2">
                    <span className="truncate"><span className="font-mono text-xs text-slate-400 mr-2">{p.code}</span>{p.name}</span>
                    <span className="tabular-nums text-sm text-slate-600">{formatMoney(p.selling_price, sym)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lines */}
          <div className="col-span-12">
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2 w-24">Qty</th>
                    <th className="text-right px-3 py-2 w-32">Price</th>
                    <th className="text-right px-3 py-2 w-28">Amount</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-slate-400 py-8">
                      <FileText className="h-7 w-7 mx-auto mb-1 opacity-40" />Search above to add items
                    </td></tr>
                  ) : lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{l.name}{prodById.get(l.refId)?.taxable === false && <span className="ml-2 text-[10px] text-slate-400">(non-taxable)</span>}</td>
                      <td className="px-2 py-1.5">
                        <Input type="number" min="0" step="1" value={l.qty}
                          onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })}
                          className="h-8 text-right tabular-nums" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" min="0" step="0.01" value={l.price}
                          onChange={(e) => setLine(i, { price: Number(e.target.value) || 0 })}
                          className="h-8 text-right tabular-nums" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(Number(l.qty) * Number(l.price), sym)}</td>
                      <td className="px-1 py-1.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeLine(i)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Notes + totals */}
          <div className="col-span-12 sm:col-span-7">
            <Label htmlFor="q_notes">Notes</Label>
            <Textarea id="q_notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terms, delivery, etc." />
          </div>
          <div className="col-span-12 sm:col-span-5 bg-slate-50 rounded-md p-3 text-sm space-y-1.5 self-end">
            <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span className="tabular-nums">{formatMoney(totals.subtotal, sym)}</span></div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-slate-600">Discount</span>
              <Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="h-8 w-28 text-right tabular-nums" />
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>{taxName} ({taxRate}%{taxInclusive ? " incl." : ""}) — from Settings, taxable items</span>
              <span className="tabular-nums">{formatMoney(totals.tax, sym)}</span>
            </div>
            <div className="border-t pt-1.5 flex justify-between font-bold text-base">
              <span>Total</span><span className="tabular-nums">{formatMoney(totals.total, sym)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {quote ? "Save changes" : "Create quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Open a printable quote in a new window. */
function printQuote(q: Quotation) {
  if (typeof window === "undefined") return;
  const rows = (q.items || []).map((l: QuotationLine) =>
    `<tr><td>${escapeHtml(l.name)}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${Number(l.price).toFixed(2)}</td><td style="text-align:right">${(Number(l.qty) * Number(l.price)).toFixed(2)}</td></tr>`
  ).join("");
  const html = `<!doctype html><html><head><title>${escapeHtml(q.quote_no)}</title>
    <style>body{font-family:system-ui,sans-serif;padding:32px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #e2e8f0;font-size:14px}th{text-align:left;background:#f8fafc;text-transform:uppercase;font-size:11px;letter-spacing:.05em;color:#64748b}h1{font-size:22px}.muted{color:#64748b;font-size:13px}.totals{margin-top:12px;text-align:right;font-size:14px}.totals b{font-size:16px}</style>
    </head><body>
    <h1>Quotation ${escapeHtml(q.quote_no)}</h1>
    <div class="muted">Date: ${formatDate(q.date)}${q.valid_until ? ` &middot; Valid until: ${formatDate(q.valid_until)}` : ""}</div>
    <table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">
      <div>Subtotal: ${Number(q.subtotal).toFixed(2)}</div>
      ${Number(q.discount) > 0 ? `<div>Discount: -${Number(q.discount).toFixed(2)}</div>` : ""}
      <div>Tax: ${Number(q.tax).toFixed(2)}</div>
      <div><b>Total: ${Number(q.total).toFixed(2)}</b></div>
    </div>
    ${q.notes ? `<p class="muted" style="margin-top:16px">${escapeHtml(q.notes)}</p>` : ""}
    <script>window.onload=function(){window.print()}</script>
    </body></html>`;
  const w = window.open("", "_blank", "width=800,height=900");
  if (w) { w.document.write(html); w.document.close(); }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
