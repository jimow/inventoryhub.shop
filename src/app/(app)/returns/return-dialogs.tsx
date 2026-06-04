"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import type { Sale, SaleLine, Purchase, PurchaseLine, Product, PaymentMethod, SettingsData, ReturnLine } from "@/lib/types";
import { formatMoney, formatDate, formatDateTime, currencySymbol } from "@/lib/utils";
import { createSalesReturn, createPurchaseReturn, listSoldUnits, listPurchaseUnits } from "./actions";

type Unit = { id: string; serial_no: string; barcode: string | null };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Read-only view of the return(s) made against a sale or purchase. */
export type ReturnRecord = {
  return_no: string | null;
  date: string;
  created_at: string;
  items: ReturnLine[];
  subtotal: number;
  tax: number;
  total: number;
  refund_method: string;
  status: string;
};

export function ReturnDetailsDialog({
  title, refundLabels, returns, settings, onClose,
}: {
  title: string;
  refundLabels: Record<string, string>;
  returns: ReturnRecord[];
  settings: SettingsData;
  onClose: () => void;
}) {
  const sym = currencySymbol(settings);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{returns.length} return(s) recorded against this document.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {returns.map((r, idx) => (
            <div key={idx} className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b">
                <div className="min-w-0">
                  <span className="font-mono font-medium text-slate-800">{r.return_no}</span>
                  <span className="text-xs text-slate-500 ml-2">{formatDateTime(r.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "posted" ? "success" : "danger"}>{r.status}</Badge>
                  <Badge variant="info">{refundLabels[r.refund_method] || r.refund_method}</Badge>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-white text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-1.5">Item</th>
                    <th className="text-right px-3 py-1.5 w-16">Qty</th>
                    <th className="text-right px-3 py-1.5 w-28">Price</th>
                    <th className="text-right px-3 py-1.5 w-28">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.items || []).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">
                        {l.name}
                        {(l.unit_ids?.length ?? 0) > 0 && <span className="ml-1 text-[11px] text-slate-400">({l.unit_ids!.length} serial)</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(Number(l.price), sym)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{formatMoney(Number(l.qty) * Number(l.price), sym)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-slate-50 font-semibold">
                    <td className="px-3 py-1.5" colSpan={3}>Total {r.tax > 0 ? `(incl. tax ${formatMoney(r.tax, sym)})` : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.total, sym)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Chips for selecting which serial units to return. */
function SerialPicker({ units, selected, loading, onToggle }: {
  units: Unit[]; selected: Set<string>; loading: boolean; onToggle: (id: string) => void;
}) {
  if (loading) return <div className="text-xs text-slate-500 py-1"><Loader2 className="inline h-3 w-3 animate-spin mr-1" />loading serials…</div>;
  if (!units.length) return <div className="text-xs text-slate-400 py-1">No serial units available to return.</div>;
  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {units.map((u) => (
        <button
          key={u.id} type="button" onClick={() => onToggle(u.id)}
          className={`px-2 py-1 rounded-md border text-xs font-mono transition-colors ${selected.has(u.id) ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-200 hover:border-blue-300"}`}
        >
          {u.serial_no}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SALES RETURN                                                               */
/* -------------------------------------------------------------------------- */
export function SalesReturnDialog({
  sale, products, methods, settings, onClose, partyName,
}: {
  sale: Sale; products: Product[]; methods: PaymentMethod[]; settings: SettingsData; onClose: () => void; partyName?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);
  const lines = (sale.items || []) as SaleLine[];
  const prodOf = (id: string) => products.find((p) => p.id === id);

  const [qty, setQty] = useState<Record<number, number>>({});
  const [serialSel, setSerialSel] = useState<Record<number, Set<string>>>({});
  const [units, setUnits] = useState<Record<number, Unit[]>>({});
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [refund, setRefund] = useState<"credit" | "cash">(sale.sale_type === "cash" ? "cash" : "credit");
  const [methodId, setMethodId] = useState(methods.find((m) => m.kind === "cash")?.id || methods[0]?.id || "");

  useEffect(() => {
    let active = true;
    const serialLines = lines.map((l, i) => ({ l, i })).filter((x) => prodOf(x.l.refId)?.serial_tracked);
    if (!serialLines.length) return;
    setLoadingUnits(true);
    (async () => {
      const res: Record<number, Unit[]> = {};
      for (const { l, i } of serialLines) {
        const r = await listSoldUnits(sale.id, l.refId);
        if (r.ok && r.units) res[i] = r.units;
      }
      if (active) { setUnits(res); setLoadingUnits(false); }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.id]);

  function toggleSerial(i: number, id: string) {
    setSerialSel((prev) => {
      const cur = new Set(prev[i] || []);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      return { ...prev, [i]: cur };
    });
  }

  const picked = lines.map((l, i) => {
    const serial = !!prodOf(l.refId)?.serial_tracked;
    const q = serial ? (serialSel[i]?.size || 0) : Math.max(0, Math.min(Number(qty[i] || 0), Number(l.qty)));
    return { l, i, serial, q, unit_ids: serial ? Array.from(serialSel[i] || []) : undefined };
  }).filter((x) => x.q > 0);
  const subtotal = picked.reduce((s, x) => s + x.q * Number(x.l.price), 0);
  const taxRate = Number(sale.subtotal) > 0 ? Number(sale.tax) / Number(sale.subtotal) : 0;
  const total = r2(subtotal * (1 + taxRate));

  function submit() {
    if (!picked.length) { toast.error("Select items or serials to return"); return; }
    const built = picked.map(({ l, q, unit_ids }) => ({ refId: l.refId, name: l.name, qty: q, price: Number(l.price), unit_ids }));
    start(async () => {
      const r = await createSalesReturn({ sale_id: sale.id, lines: built, refund_method: refund, payment_method_id: refund === "cash" ? (methodId || null) : null });
      if (!r.ok) { toast.error(r.error || "Return failed"); return; }
      toast.success(`Return ${r.return_no} recorded`);
      onClose(); router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sales return · {sale.invoice_no}</DialogTitle>
          <DialogDescription>Choose quantities (or specific serial numbers) to return. Stock goes back and the sale is reversed with double-entry.</DialogDescription>
        </DialogHeader>

        {/* Source sale details */}
        <div className="rounded-md bg-slate-50 border grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 text-sm">
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Invoice</div><div className="font-mono font-medium">{sale.invoice_no}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Customer</div><div className="truncate">{partyName || "Walk-in"}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Date · type</div><div>{formatDate(sale.date)} · {sale.sale_type}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Original total</div><div className="tabular-nums font-medium">{formatMoney(sale.total, sym)}</div></div>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => {
            const serial = !!prodOf(l.refId)?.serial_tracked;
            return (
              <div key={i} className="border rounded-md p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{l.name}</div>
                    <div className="text-[11px] text-slate-500">
                      Sold {l.qty} @ {formatMoney(Number(l.price), sym)} = {formatMoney(Number(l.qty) * Number(l.price), sym)}
                      {serial && <Badge variant="secondary" className="ml-1">serial</Badge>}
                    </div>
                  </div>
                  {serial ? (
                    <div className="text-xs text-slate-500 tabular-nums">{serialSel[i]?.size || 0} selected</div>
                  ) : (
                    <Input type="number" min="0" max={Number(l.qty)} step="1" className="h-8 w-24 text-right tabular-nums"
                      value={qty[i] ?? ""} placeholder="0"
                      onChange={(e) => setQty((p) => ({ ...p, [i]: Number(e.target.value) || 0 }))} />
                  )}
                </div>
                {serial && <SerialPicker units={units[i] || []} selected={serialSel[i] || new Set()} loading={loadingUnits} onToggle={(id) => toggleSerial(i, id)} />}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <Label htmlFor="refund">Refund as</Label>
            <Select id="refund" value={refund} onChange={(e) => setRefund(e.target.value as "credit" | "cash")}>
              <option value="credit">Credit to customer (reduce balance)</option>
              <option value="cash">Cash refund (pay out)</option>
            </Select>
          </div>
          {refund === "cash" && (
            <div>
              <Label htmlFor="rm">Refund from</Label>
              <Select id="rm" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-between items-center bg-slate-50 rounded-md px-3 py-2 mt-1 text-sm">
          <span className="text-slate-600">Total refund</span>
          <span className="font-bold tabular-nums">{formatMoney(total, sym)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending || !picked.length}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Process return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* PURCHASE RETURN                                                            */
/* -------------------------------------------------------------------------- */
export function PurchaseReturnDialog({
  purchase, products, methods, settings, onClose, partyName,
}: {
  purchase: Purchase; products: Product[]; methods: PaymentMethod[]; settings: SettingsData; onClose: () => void; partyName?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);
  const lines = (purchase.items || []) as PurchaseLine[];
  const prodOf = (id: string) => products.find((p) => p.id === id);

  const [qty, setQty] = useState<Record<number, number>>({});
  const [serialSel, setSerialSel] = useState<Record<number, Set<string>>>({});
  const [units, setUnits] = useState<Record<number, Unit[]>>({});
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [refund, setRefund] = useState<"balance" | "cash">(purchase.purchase_type === "cash" ? "cash" : "balance");
  const [methodId, setMethodId] = useState(methods.find((m) => m.kind === "cash")?.id || methods[0]?.id || "");

  useEffect(() => {
    let active = true;
    const serialLines = lines.map((l, i) => ({ l, i })).filter((x) => prodOf(x.l.refId)?.serial_tracked);
    if (!serialLines.length) return;
    setLoadingUnits(true);
    (async () => {
      const res: Record<number, Unit[]> = {};
      for (const { l, i } of serialLines) {
        const r = await listPurchaseUnits(purchase.id, l.refId);
        if (r.ok && r.units) res[i] = r.units;
      }
      if (active) { setUnits(res); setLoadingUnits(false); }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase.id]);

  function toggleSerial(i: number, id: string) {
    setSerialSel((prev) => {
      const cur = new Set(prev[i] || []);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      return { ...prev, [i]: cur };
    });
  }

  const picked = lines.map((l, i) => {
    const serial = !!prodOf(l.refId)?.serial_tracked;
    const q = serial ? (serialSel[i]?.size || 0) : Math.max(0, Math.min(Number(qty[i] || 0), Number(l.qty)));
    return { l, i, serial, q, unit_ids: serial ? Array.from(serialSel[i] || []) : undefined };
  }).filter((x) => x.q > 0);
  const subtotal = picked.reduce((s, x) => s + x.q * Number(x.l.price), 0);
  const taxRate = Number(purchase.subtotal) > 0 ? Number(purchase.tax) / Number(purchase.subtotal) : 0;
  const total = r2(subtotal * (1 + taxRate));

  function submit() {
    if (!picked.length) { toast.error("Select items or serials to return"); return; }
    const built = picked.map(({ l, q, unit_ids }) => ({ refId: l.refId, name: l.name, qty: q, price: Number(l.price), unit_ids }));
    start(async () => {
      const r = await createPurchaseReturn({ purchase_id: purchase.id, lines: built, refund_method: refund, payment_method_id: refund === "cash" ? (methodId || null) : null });
      if (!r.ok) { toast.error(r.error || "Return failed"); return; }
      toast.success(`Return ${r.return_no} recorded`);
      onClose(); router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Purchase return · {purchase.po_no}</DialogTitle>
          <DialogDescription>Choose quantities (or specific serials) to return to the supplier. Stock is reduced and the purchase is reversed with double-entry.</DialogDescription>
        </DialogHeader>

        {/* Source purchase details */}
        <div className="rounded-md bg-slate-50 border grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 text-sm">
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">PO #</div><div className="font-mono font-medium">{purchase.po_no}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Supplier</div><div className="truncate">{partyName || "—"}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Date · type</div><div>{formatDate(purchase.date)} · {purchase.purchase_type}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-slate-500">Original total</div><div className="tabular-nums font-medium">{formatMoney(purchase.total, sym)}</div></div>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => {
            const serial = !!prodOf(l.refId)?.serial_tracked;
            return (
              <div key={i} className="border rounded-md p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{l.name}</div>
                    <div className="text-[11px] text-slate-500">
                      Bought {l.qty} @ {formatMoney(Number(l.price), sym)} = {formatMoney(Number(l.qty) * Number(l.price), sym)}
                      {serial && <Badge variant="secondary" className="ml-1">serial</Badge>}
                    </div>
                  </div>
                  {serial ? (
                    <div className="text-xs text-slate-500 tabular-nums">{serialSel[i]?.size || 0} selected</div>
                  ) : (
                    <Input type="number" min="0" max={Number(l.qty)} step="1" className="h-8 w-24 text-right tabular-nums"
                      value={qty[i] ?? ""} placeholder="0"
                      onChange={(e) => setQty((p) => ({ ...p, [i]: Number(e.target.value) || 0 }))} />
                  )}
                </div>
                {serial && <SerialPicker units={units[i] || []} selected={serialSel[i] || new Set()} loading={loadingUnits} onToggle={(id) => toggleSerial(i, id)} />}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <Label htmlFor="prefund">Settle as</Label>
            <Select id="prefund" value={refund} onChange={(e) => setRefund(e.target.value as "balance" | "cash")}>
              <option value="balance">Reduce what we owe (A/P)</option>
              <option value="cash">Cash refund from supplier</option>
            </Select>
          </div>
          {refund === "cash" && (
            <div>
              <Label htmlFor="prm">Refund into</Label>
              <Select id="prm" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-between items-center bg-slate-50 rounded-md px-3 py-2 mt-1 text-sm">
          <span className="text-slate-600">Total return value</span>
          <span className="font-bold tabular-nums">{formatMoney(total, sym)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending || !picked.length}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Process return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
