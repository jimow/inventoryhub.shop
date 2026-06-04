"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Eye, X, Send, PackageCheck, Wallet, Trash2, Loader2, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

import { DataTable, type Column, type FilterDef, type BulkAction } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { ExportButton } from "@/components/export-button";

import type { Purchase, PurchaseLine, PurchaseType, Product, Supplier, SettingsData, PaymentMethod, PurchaseReturn } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, formatDateTime, currencySymbol, computeLineTotals } from "@/lib/utils";
import {
  createPurchase, createCashPurchase, updatePurchase, deletePurchase,
  markOrdered, receivePurchase, cancelPurchase, recordPurchasePayment,
  bulkCancelPurchases, bulkDeletePurchases, exportPurchases,
} from "./actions";
import { PurchaseReturnDialog, ReturnDetailsDialog } from "../returns/return-dialogs";

type Mode = "view" | "edit" | "create" | "pay" | "receive" | null;

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "ordered", label: "Ordered" },
  { value: "received", label: "Received (Unpaid)" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];
const TYPE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "credit", label: "Credit" },
];

function isOverdue(po: Purchase) {
  if (!po.due_date) return false;
  if (po.status === "paid" || po.status === "cancelled") return false;
  return new Date(po.due_date) < new Date(new Date().toISOString().slice(0, 10));
}

export function PurchasesClient({
  purchases, totalCount, suppliers, products, methods, returnsByPurchase, returnsListByPurchase, settings, permissions,
}: {
  purchases: Purchase[];
  totalCount: number;
  suppliers: Supplier[];
  products: Product[];
  methods: PaymentMethod[];
  returnsByPurchase: Record<string, "full" | "partial">;
  returnsListByPurchase: Record<string, PurchaseReturn[]>;
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sp = useSearchParams();
  const [active, setActive] = useState<Purchase | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [returning, setReturning] = useState<Purchase | null>(null);
  const [viewReturns, setViewReturns] = useState<PurchaseReturn[] | null>(null);
  const sym = currencySymbol(settings);

  // Deep-link: /purchases?new=1[&supplier_id=â€¦] opens the New Purchase editor
  // (used by the "New purchase" action on the supplier list).
  const prefillSupplier = sp.get("supplier_id") || "";
  useEffect(() => {
    if (sp.get("new") === "1") { setActive(null); setMode("create"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: Column<Purchase>[] = [
    { key: "po_no", label: "PO #", className: "w-[140px] font-medium",
      render: (r) => (
        <button onClick={() => { setActive(r); setMode("view"); }} className="font-mono font-medium text-blue-600 hover:underline" title="View purchase">
          {r.po_no}
        </button>
      ) },
    { key: "date", label: "Date & time", className: "w-[150px] whitespace-nowrap", render: (r) => formatDateTime(r.created_at) },
    { key: "supplier", label: "Supplier",
      render: (r) => {
        const s = suppliers.find((x) => x.id === r.supplier_id);
        return s ? <Link href={`/suppliers/${s.id}`} className="font-medium text-blue-600 hover:underline">{s.name}</Link> : <span className="text-slate-400">â€”</span>;
      } },
    { key: "purchase_type", label: "Type", className: "w-[90px]",
      render: (r) => <TypeBadge type={r.purchase_type} /> },
    { key: "total", label: "Total", className: "w-[120px] text-right",
      render: (r) => formatMoney(r.total, sym) },
    { key: "balance", label: "Balance", className: "w-[120px] text-right",
      render: (r) => {
        const bal = Number(r.total) - Number(r.amount_paid || 0);
        if (r.status === "cancelled") return <span className="text-muted-foreground">â€”</span>;
        if (bal <= 0.001) return <span className="text-emerald-700">Paid</span>;
        return <span className={isOverdue(r) ? "text-red-600 font-medium" : ""}>{formatMoney(bal, sym)}</span>;
      } },
    { key: "status", label: "Status", className: "w-[160px]",
      render: (r) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge po={r} />
          {returnsByPurchase[r.id] && (
            <button type="button" onClick={() => setViewReturns(returnsListByPurchase[r.id] || [])} title="View what was returned">
              <Badge variant="warning" className="gap-1 cursor-pointer hover:ring-2 hover:ring-amber-300">
                <Undo2 className="h-3 w-3" /> {returnsByPurchase[r.id] === "full" ? "Returned" : "Part. returned"}
              </Badge>
            </button>
          )}
        </div>
      ) },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: STATUS_OPTIONS },
    { key: "purchase_type", label: "Type", options: TYPE_OPTIONS },
    { key: "supplier_id", label: "Supplier",
      options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
  ];

  const bulkActions: BulkAction<Purchase>[] = [];
  if (can(permissions, "purchases", "edit")) {
    bulkActions.push({ label: "Cancel", icon: X, variant: "outline",
      run: (rows) => bulkCancelPurchases(rows.map((r) => r.id)) });
  }
  if (can(permissions, "purchases", "delete")) {
    bulkActions.push({ label: "Delete", icon: Trash2, variant: "destructive",
      run: (rows) => bulkDeletePurchases(rows.map((r) => r.id)) });
  }

  return (
    <div>
      <PageHeader title="Purchases" description="Cash and credit purchase orders">
        <ExportButton action={() => exportPurchases(
          sp.get("q") || undefined, sp.get("status") || undefined, sp.get("purchase_type") || undefined,
          sp.get("supplier_id") || undefined, sp.get("from") || undefined, sp.get("to") || undefined,
        )} />
        {can(permissions, "purchases", "create") && (
          <Button size="sm" onClick={() => { setActive(null); setMode("create"); }}>
            <Plus className="h-4 w-4" /> New Purchase
          </Button>
        )}
      </PageHeader>

      <DataTable<Purchase>
        columns={columns}
        data={purchases}
        totalCount={totalCount}
        searchPlaceholder="Search by PO number..."
        filters={filters}
        bulkActions={bulkActions}
        rowActions={(row) => (
          <PurchaseRowActions row={row} permissions={permissions}
            products={products}
            onView={() => { setActive(row); setMode("view"); }}
            onEdit={() => { setActive(row); setMode("edit"); }}
            onPay={() => { setActive(row); setMode("pay"); }}
            onReceive={() => { setActive(row); setMode("receive"); }}
            onPrint={() => printPurchaseOrder(row, suppliers.find((s) => s.id === row.supplier_id), settings)}
            onReturn={() => setReturning(row)} />
        )}
      />

      {returning && (
        <PurchaseReturnDialog
          purchase={returning} products={products} methods={methods} settings={settings}
          partyName={suppliers.find((s) => s.id === returning.supplier_id)?.name}
          onClose={() => setReturning(null)} />
      )}

      {viewReturns && (
        <ReturnDetailsDialog
          title="Returns against this purchase"
          refundLabels={{ cash: "Cash refund", balance: "A/P credit" }}
          returns={viewReturns}
          settings={settings}
          onClose={() => setViewReturns(null)} />
      )}

      {mode === "create" && (
        <PurchaseEditor purchase={null} suppliers={suppliers} products={products} settings={settings} methods={methods}
          initialSupplierId={prefillSupplier}
          onClose={() => setMode(null)} />
      )}
      {mode === "edit" && active && (
        <PurchaseEditor purchase={active} suppliers={suppliers} products={products} settings={settings} methods={methods}
          onClose={() => { setMode(null); setActive(null); }} />
      )}
      {mode === "view" && active && (
        <PurchaseViewer purchase={active} suppliers={suppliers} settings={settings}
          onClose={() => { setMode(null); setActive(null); }} />
      )}
      {mode === "pay" && active && (
        <PaymentDialog po={active} settings={settings}
          onClose={() => { setMode(null); setActive(null); }} />
      )}
      {mode === "receive" && active && (
        <ReceiveDialog purchase={active} products={products} methods={methods} settings={settings}
          onClose={() => { setMode(null); setActive(null); }} />
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: PurchaseType }) {
  const v = ({ cash: "success", credit: "warning" } as const)[type];
  return <Badge variant={v}>{type}</Badge>;
}

function StatusBadge({ po }: { po: Purchase }) {
  if (isOverdue(po)) return <Badge variant="danger">overdue</Badge>;
  const map: Record<string, "secondary" | "info" | "success" | "danger" | "warning"> = {
    draft: "secondary", ordered: "info", received: "warning", paid: "success", cancelled: "danger",
  };
  const label = po.status === "received" ? "unpaid" : po.status;
  return <Badge variant={map[po.status] || "secondary"}>{label}</Badge>;
}

function PurchaseRowActions({
  row, permissions, products, onView, onEdit, onPay, onReceive, onPrint, onReturn,
}: {
  row: Purchase; permissions: PermissionMatrix; products: Product[];
  onView: () => void; onEdit: () => void; onPay: () => void; onReceive: () => void; onPrint: () => void; onReturn: () => void;
}) {
  const router = useRouter();
  const productMap = new Map(products.map((p) => [p.id, p]));
  const needsSerials = (row.items || []).some(
    (l) => productMap.get(l.refId)?.serial_tracked,
  );
  const [pending, start] = useTransition();
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(success);
      router.refresh();
    });
  }
  return (
    <>
      <Button variant="ghost" size="icon" onClick={onView} title="View"><Eye className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" onClick={onPrint} title="Print purchase order" className="text-slate-600"><Printer className="h-4 w-4" /></Button>
      {row.status === "draft" && can(permissions, "purchases", "edit") && (
        <>
          <Button variant="ghost" size="icon" onClick={onEdit} title="Edit"><Pencil className="h-4 w-4" /></Button>
          {/* One-step for cash: confirm + receive + serials + pay in one dialog. */}
          <Button variant="ghost" size="icon" disabled={pending} onClick={onReceive}
            title="Receive & Pay" className="text-emerald-600"><PackageCheck className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" disabled={pending} onClick={() => run(() => markOrdered(row.id), "Marked ordered")} title="Mark Ordered" className="text-blue-600"><Send className="h-4 w-4" /></Button>
        </>
      )}
      {row.status === "ordered" && can(permissions, "purchases", "edit") && (
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          onClick={() => {
            // Cash purchases open the dialog so the amount paid (and any
            // partial balance) can be entered; serial-tracked too.
            if (needsSerials || row.purchase_type === "cash") {
              onReceive();
            } else {
              run(() => receivePurchase(row.id), "Received");
            }
          }}
          title={needsSerials ? "Receive (capture serials)" : "Receive"}
          className="text-emerald-600">
          <PackageCheck className="h-4 w-4" />
        </Button>
      )}
      {row.status === "received" && can(permissions, "purchases", "edit") && (
        <Button variant="ghost" size="icon" disabled={pending} onClick={onPay} title="Record payment" className="text-emerald-600"><Wallet className="h-4 w-4" /></Button>
      )}
      {(row.status === "received" || row.status === "paid") && can(permissions, "returns", "create") && (
        <Button variant="ghost" size="icon" onClick={onReturn} title="Purchase return" className="text-orange-600"><Undo2 className="h-4 w-4" /></Button>
      )}
      {row.status !== "cancelled" && can(permissions, "purchases", "edit") && (
        <Button variant="ghost" size="icon" disabled={pending} onClick={() => run(() => cancelPurchase(row.id), "Cancelled")} title="Cancel" className="text-amber-600"><X className="h-4 w-4" /></Button>
      )}
      {can(permissions, "purchases", "delete") && (
        <DeleteButton action={() => deletePurchase(row.id)} message="Stock will be reverted if this PO was received/paid." />
      )}
    </>
  );
}

function PaymentDialog({ po, settings, onClose }: { po: Purchase; settings: SettingsData; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const balance = Number(po.total) - Number(po.amount_paid || 0);
  const [amount, setAmount] = useState(balance.toFixed(2));
  const sym = currencySymbol(settings);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await recordPurchasePayment(po.id, Number(amount));
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success("Payment recorded");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment â€” {po.po_no}</DialogTitle>
          <DialogDescription>Outstanding balance: <b>{formatMoney(balance, sym)}</b></DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="amt">Payment Amount</Label>
            <Input id="amt" type="number" step="0.01" min="0.01" max={balance.toFixed(2)}
              value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAmount(balance.toFixed(2))}>Pay full</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAmount((balance / 2).toFixed(2))}>Pay half</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseViewer({ purchase, suppliers, settings, onClose }: { purchase: Purchase; suppliers: Supplier[]; settings: SettingsData; onClose: () => void }) {
  const sup = suppliers.find((s) => s.id === purchase.supplier_id);
  const sym = currencySymbol(settings);
  const balance = Number(purchase.total) - Number(purchase.amount_paid || 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Purchase {purchase.po_no} <TypeBadge type={purchase.purchase_type} /> <StatusBadge po={purchase} />
          </DialogTitle>
          <DialogDescription>{formatDate(purchase.date)} {purchase.due_date && `Â· due ${formatDate(purchase.due_date)}`}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <div><b>Supplier:</b> {sup?.name || "-"}</div>
          <div><b>Email:</b> {sup?.email || "-"}</div>
        </div>
        <table className="w-full text-sm border-t">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-2">Item</th>
              <th className="text-right p-2 w-20">Qty</th>
              <th className="text-right p-2 w-24">Cost</th>
              <th className="text-right p-2 w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {(purchase.items || []).map((l, i) => (
              <tr key={i} className="border-t">
                <td className="p-2">{l.name}</td>
                <td className="p-2 text-right">{l.qty}</td>
                <td className="p-2 text-right">{formatMoney(l.price, sym)}</td>
                <td className="p-2 text-right">{formatMoney(Number(l.qty) * Number(l.price), sym)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-slate-100 rounded-md p-3 mt-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(purchase.subtotal, sym)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>{formatMoney(purchase.discount, sym)}</span></div>
          <div className="flex justify-between"><span>Tax ({purchase.tax_rate}%)</span><span>{formatMoney(purchase.tax, sym)}</span></div>
          {Number(purchase.transport_cost || 0) > 0 && (
            <div className="flex justify-between"><span>Transport</span><span>{formatMoney(Number(purchase.transport_cost), sym)}</span></div>
          )}
          {Number(purchase.other_charges || 0) > 0 && (
            <div className="flex justify-between"><span>Other charges</span><span>{formatMoney(Number(purchase.other_charges), sym)}</span></div>
          )}
          <div className="flex justify-between font-semibold pt-2 mt-2 border-t border-slate-300">
            <span>Total</span><span>{formatMoney(purchase.total, sym)}</span>
          </div>
          {purchase.purchase_type === "credit" && (
            <>
              <div className="flex justify-between text-emerald-700"><span>Amount Paid</span><span>{formatMoney(purchase.amount_paid, sym)}</span></div>
              <div className="flex justify-between font-semibold"><span>Balance</span>
                <span className={balance > 0.001 ? "text-red-600" : "text-emerald-700"}>{formatMoney(balance, sym)}</span></div>
            </>
          )}
        </div>
        {purchase.notes && <div className="mt-3 text-sm"><b>Notes:</b> {purchase.notes}</div>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseEditor({
  purchase, suppliers, products, settings, methods, onClose, initialSupplierId,
}: {
  purchase: Purchase | null;
  suppliers: Supplier[];
  products: Product[];
  settings: SettingsData;
  methods: PaymentMethod[];
  onClose: () => void;
  initialSupplierId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);
  const [lines, setLines] = useState<PurchaseLine[]>(purchase?.items || []);
  const [discount, setDiscount] = useState(Number(purchase?.discount ?? 0));
  const [taxRate, setTaxRate] = useState(Number(purchase?.tax_rate ?? settings.tax?.defaultRate ?? 0));
  const [transportCost, setTransportCost] = useState(Number(purchase?.transport_cost ?? 0));
  const [otherCharges, setOtherCharges] = useState(Number(purchase?.other_charges ?? 0));
  const [purchaseType, setPurchaseType] = useState<PurchaseType>(purchase?.purchase_type || "cash");
  const [supplierId, setSupplierId] = useState<string>(purchase?.supplier_id || initialSupplierId || "");
  const [addKey, setAddKey] = useState(0);

  // Cash purchases capture serials + payment inline (one dialog, no process).
  const isNewCash = !purchase && purchaseType === "cash";
  const [serials, setSerials] = useState<Record<string, { serial: string; barcode: string }[]>>({});
  const [methodId, setMethodId] = useState<string>(methods.find((m) => m.kind === "cash")?.id || methods[0]?.id || "");
  const [paid, setPaid] = useState<number>(0);
  const [paidTouched, setPaidTouched] = useState(false);

  function unitsFor(refId: string, qty: number) {
    const arr = serials[refId] ? [...serials[refId]] : [];
    while (arr.length < qty) arr.push({ serial: "", barcode: "" });
    return arr.slice(0, Math.max(0, qty));
  }
  function setUnit(refId: string, idx: number, key: "serial" | "barcode", v: string) {
    setSerials((prev) => {
      const cur = prev[refId] ? [...prev[refId]] : [];
      while (cur.length <= idx) cur.push({ serial: "", barcode: "" });
      cur[idx] = { ...cur[idx], [key]: v };
      return { ...prev, [refId]: cur };
    });
  }

  // Honor the tax-inclusive setting so line prices match the supplier invoice
  // grand total instead of double-taxing.
  const taxInclusive = !!settings.tax?.inclusive;
  const totals = useMemo(
    () => computeLineTotals(lines, discount, taxRate, taxInclusive),
    [lines, discount, taxRate, taxInclusive],
  );
  const lineCharges = lines.reduce((s, l) => s + Math.max(0, Number(l.charge || 0) || 0), 0);
  const grandTotal = totals.total + (Number(transportCost) || 0) + (Number(otherCharges) || 0) + lineCharges;

  // Keep "amount paid" pinned to the total until the user overrides it.
  useEffect(() => { if (isNewCash && !paidTouched) setPaid(Math.round(grandTotal * 100) / 100); }, [grandTotal, isNewCash, paidTouched]);
  const serialLines = lines
    .map((l, i) => ({ l, i, prod: products.find((p) => p.id === l.refId) }))
    .filter((x) => x.l.refId && x.prod?.serial_tracked);
  const paidPartial = isNewCash && paid < grandTotal - 0.01;

  function addLineAfter(index: number) {
    const blank: PurchaseLine = { refId: "", name: "", qty: 1, price: 0 };
    if (index < 0) setLines([...lines, blank]);
    else setLines([...lines.slice(0, index + 1), blank, ...lines.slice(index + 1)]);
  }

  function pickItem(index: number, itemId: string) {
    if (!itemId) return;
    const it = products.find((x) => x.id === itemId);
    if (!it) return;
    const dupIndex = lines.findIndex((l, i) => i !== index && l.refId === itemId);
    if (dupIndex >= 0) {
      const next = [...lines];
      const addQty = Number(next[index].qty) || 1;
      next[dupIndex] = { ...next[dupIndex], qty: Number(next[dupIndex].qty) + addQty };
      next.splice(index, 1);
      setLines(next);
      toast.info(`Added ${addQty} to existing ${it.name}`);
      return;
    }
    const next = [...lines];
    next[index] = {
      refId: it.id,
      name: it.name,
      qty: Number(next[index].qty) || 1,
      price: Number(it.cost_price),
    };
    setLines(next);
  }

  /** Search-to-add: append the item (or +1 qty if already on the order). */
  function addProductById(productId: string) {
    if (!productId) return;
    const it = products.find((p) => p.id === productId);
    if (!it) return;
    const dup = lines.findIndex((l) => l.refId === productId);
    if (dup >= 0) {
      const next = [...lines];
      next[dup] = { ...next[dup], qty: Number(next[dup].qty) + 1 };
      setLines(next);
      toast.info(`+1 ${it.name}`);
    } else {
      setLines([...lines, { refId: it.id, name: it.name, qty: 1, price: Number(it.cost_price) }]);
    }
    setAddKey((k) => k + 1);
  }

  function setQty(index: number, qty: number) {
    const next = [...lines];
    next[index] = { ...next[index], qty: Math.max(0, qty) };
    setLines(next);
  }

  const quickAddProducts = useMemo(
    () => [...products].filter((p) => p.status === "active").slice(0, 14),
    [products],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const filled = lines.filter((l) => l.refId);
    if (!filled.length) { toast.error("Add at least one item line"); return; }
    if (!supplierId) { toast.error("Select a supplier"); return; }
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(filled));
    fd.set("supplier_id", supplierId);

    // CASH (new): create + receive + pay in this one dialog. Validate serials
    // (one per unit, count = qty, non-blank, unique) and build the payload.
    if (isNewCash) {
      const serialsByLine: Record<number, { serial: string; barcode?: string }[]> = {};
      for (let i = 0; i < filled.length; i++) {
        const l = filled[i];
        const prod = products.find((p) => p.id === l.refId);
        if (!prod?.serial_tracked) continue;
        const qty = Number(l.qty);
        const units = unitsFor(l.refId, qty);
        const seen = new Set<string>();
        for (let u = 0; u < qty; u++) {
          const s = (units[u]?.serial || "").trim();
          if (!s) { toast.error(`${l.name}: serial #${u + 1} of ${qty} is required`); return; }
          if (seen.has(s)) { toast.error(`${l.name}: duplicate serial "${s}"`); return; }
          seen.add(s);
        }
        serialsByLine[i] = units.slice(0, qty).map((u) => ({ serial: u.serial.trim(), barcode: u.barcode.trim() || undefined }));
      }
      start(async () => {
        const r = await createCashPurchase(fd, serialsByLine, paid, methodId || null);
        if (!r.ok) { toast.error(r.error || "Save failed"); return; }
        toast.success(paidPartial ? "Cash purchase received â€” balance recorded" : "Cash purchase received & paid");
        onClose(); router.refresh();
      });
      return;
    }

    start(async () => {
      if (purchase) {
        const r = await updatePurchase(purchase.id, fd);
        if (!r.ok) { toast.error(r.error || "Save failed"); return; }
        toast.success("Purchase updated");
      } else {
        const r = await createPurchase(fd);
        if (!r.ok) { toast.error(r.error || "Save failed"); return; }
        toast.success("Purchase order created");
      }
      onClose(); router.refresh();
    });
  }

  const productOptions: ComboboxOption[] = products.map((it) => ({
    value: it.id,
    label: it.name,
    sub: `${it.code} Â· ${formatMoney(it.cost_price, sym)} Â· Stock: ${it.current_stock} ${it.unit}`,
  }));

  const supplierOptions: ComboboxOption[] = suppliers.map((s) => ({
    value: s.id,
    label: s.name,
    sub: s.email || s.phone || s.code,
  }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{purchase ? `Edit Purchase ${purchase.po_no}` : isNewCash ? "New Cash Purchase" : "New Purchase"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-3"><Label htmlFor="po_no">PO #</Label>
            <Input id="po_no" name="po_no" defaultValue={purchase?.po_no || ""} placeholder="(auto)" readOnly={!!purchase} />
          </div>
          <div className="col-span-3"><Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" defaultValue={purchase?.date || new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="col-span-3"><Label htmlFor="purchase_type">Type *</Label>
            <Select id="purchase_type" name="purchase_type" value={purchaseType} onChange={(e) => setPurchaseType(e.target.value as PurchaseType)} required>
              <option value="cash">Cash (paid on receipt)</option>
              <option value="credit">Credit (track balance)</option>
            </Select>
          </div>
          <div className="col-span-3"><Label htmlFor="due_date">Due Date</Label>
            <Input id="due_date" name="due_date" type="date" disabled={purchaseType !== "credit"} defaultValue={purchase?.due_date || ""} />
          </div>

          <div className="col-span-12">
            <Label>Supplier *</Label>
            <Combobox
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
              placeholder="Search supplier by name, email, code..."
              emptyText="No suppliers match"
            />
          </div>

          <div className="col-span-12">
            <Label className="block mb-1">Line Items</Label>

            {/* Fast selection: search to add, or tap a product chip. */}
            <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
              <Combobox
                key={addKey}
                value=""
                onChange={addProductById}
                options={productOptions}
                placeholder="ðŸ”  Search an item by name or code, then press Enter to add itâ€¦"
                emptyText="No items match"
              />
              {quickAddProducts.length > 0 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {quickAddProducts.map((p) => (
                    <button
                      key={p.id} type="button" onClick={() => addProductById(p.id)}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50"
                    >
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="ml-1.5 text-slate-400 tabular-nums">{formatMoney(p.cost_price, sym)}</span>
                      <span className="ml-1.5 text-[10px] text-slate-400 tabular-nums">Â· stk {p.current_stock}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              {lines.length === 0 ? (
                <div className="border rounded-md p-4 text-center bg-slate-50">
                  <p className="text-sm text-muted-foreground mb-2">No items yet</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => addLineAfter(-1)}>
                    <Plus className="h-3 w-3" /> Add first line
                  </Button>
                </div>
              ) : (
                lines.map((l, i) => {
                  const prod = products.find((p) => p.id === l.refId);
                  return (
                  <div key={i} className="grid grid-cols-12 gap-2 bg-slate-50 p-2 rounded-md items-center">
                    <div className="col-span-5 min-w-0">
                      <Combobox
                        value={l.refId}
                        onChange={(v) => pickItem(i, v)}
                        options={productOptions}
                        placeholder="Search item..."
                      />
                      {prod && (
                        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                          {prod.code} Â· Stock: {prod.current_stock} {prod.unit}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 flex items-center gap-1">
                      <button type="button" title="Decrease" onClick={() => setQty(i, Number(l.qty) - 1)}
                        className="h-8 w-6 shrink-0 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100">âˆ’</button>
                      <PurchaseQtyInput value={Number(l.qty)} onCommit={(n) => setQty(i, n)} />
                      <button type="button" title="Increase" onClick={() => setQty(i, Number(l.qty) + 1)}
                        className="h-8 w-6 shrink-0 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100">+</button>
                    </div>
                    <Input className="col-span-2" type="number" step="0.01" min="0" value={l.price} placeholder="Cost"
                      onChange={(e) => {
                        const next = [...lines]; next[i] = { ...next[i], price: Number(e.target.value) || 0 }; setLines(next);
                      }} />
                    <div className="col-span-1 text-right text-sm font-medium">
                      {formatMoney(Number(l.qty) * Number(l.price), sym)}
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" title="Remove line"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" title="Add line below"
                        onClick={() => addLineAfter(i)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {/* CASH only: serial numbers â€” one per unit, must equal the quantity */}
          {isNewCash && serialLines.length > 0 && (
            <div className="col-span-12">
              <Label className="block mb-1">Serial numbers</Label>
              <div className="space-y-3">
                {serialLines.map(({ l, prod }) => {
                  const qty = Number(l.qty);
                  const units = unitsFor(l.refId, qty);
                  const done = units.filter((u) => u.serial.trim()).length;
                  return (
                    <div key={l.refId} className="border rounded-md p-3">
                      <div className="flex items-baseline justify-between mb-2">
                        <div className="font-medium text-slate-900">{l.name} <span className="text-xs text-slate-500">Â· qty {qty}</span></div>
                        <Badge variant={done === qty ? "success" : "warning"}>{done}/{qty} entered</Badge>
                      </div>
                      <div className="grid grid-cols-12 gap-2 text-xs">
                        <div className="col-span-1 text-slate-500 font-medium">#</div>
                        <div className="col-span-6 text-slate-500 font-medium">Serial number *</div>
                        <div className="col-span-5 text-slate-500 font-medium">Barcode (optional)</div>
                        {units.map((u, unitIdx) => (
                          <Fragment key={unitIdx}>
                            <div className="col-span-1 self-center text-slate-400 tabular-nums">{unitIdx + 1}</div>
                            <Input className="col-span-6 font-mono h-9" value={u.serial}
                              onChange={(e) => setUnit(l.refId, unitIdx, "serial", e.target.value)} placeholder="e.g. SN-000123" />
                            <Input className="col-span-5 font-mono h-9" value={u.barcode}
                              onChange={(e) => setUnit(l.refId, unitIdx, "barcode", e.target.value)} placeholder="(scan or type)" />
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="col-span-8"><Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={purchase?.notes ?? ""} rows={3} />
          </div>
          <div className="col-span-4 bg-slate-100 rounded-md p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(totals.subtotal, sym)}</span></div>
            <div className="flex justify-between items-center gap-2">
              <span>Discount</span>
              <Input className="h-7 w-24" type="number" step="0.01" min="0" name="discount" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} />
            </div>
            <div className="flex justify-between items-center gap-2">
              <span>Tax %</span>
              <Input className="h-7 w-24" type="number" step="0.01" min="0" name="tax_rate" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value) || 0)} />
            </div>
            <div className="flex justify-between"><span>Tax</span><span>{formatMoney(totals.tax, sym)}</span></div>
            <div className="flex justify-between items-center gap-2">
              <span title="Freight in â€” added to inventory cost">Transport</span>
              <Input className="h-7 w-24" type="number" step="0.01" min="0" name="transport_cost" value={transportCost} onChange={(e) => setTransportCost(Number(e.target.value) || 0)} />
            </div>
            <div className="flex justify-between items-center gap-2">
              <span title="Handling, clearing, etc. â€” added to inventory cost">Other charges</span>
              <Input className="h-7 w-24" type="number" step="0.01" min="0" name="other_charges" value={otherCharges} onChange={(e) => setOtherCharges(Number(e.target.value) || 0)} />
            </div>
            <div className="flex justify-between font-semibold pt-2 border-t border-slate-300">
              <span>Total</span><span>{formatMoney(grandTotal, sym)}</span>
            </div>
            {(transportCost > 0 || otherCharges > 0 || lineCharges > 0) && (
              <p className="text-[11px] text-muted-foreground">Charges are capitalized into item cost on receive.</p>
            )}

            {/* CASH only: pay the supplier now; any shortfall is a balance owed */}
            {isNewCash && (
              <div className="border-t-2 border-dashed border-slate-300 pt-2.5 mt-2.5 space-y-2">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-600">Pay from</span>
                  <Select className="h-8 w-32" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                    {methods.length === 0 && <option value="">â€” Cash drawer â€”</option>}
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="font-semibold text-slate-700">Amount paid</span>
                  <Input className="h-8 w-28 text-right tabular-nums font-bold" type="number" step="0.01" min="0"
                    value={paid} onChange={(e) => { setPaid(Number(e.target.value) || 0); setPaidTouched(true); }} />
                </div>
                <div className={`flex justify-between items-center rounded-md px-2 py-1.5 text-xs font-semibold ${paidPartial ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                  <span>{paidPartial ? "Balance owed to supplier" : "Paid in full"}</span>
                  <span className="tabular-nums">{formatMoney(paidPartial ? grandTotal - paid : 0, sym)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-12">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : isNewCash ? `Receive & Pay ${formatMoney(grandTotal, sym)}` : (purchase ? "Save changes" : "Save order")}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({
  purchase, products, methods, settings, onClose,
}: {
  purchase: Purchase;
  products: Product[];
  methods: PaymentMethod[];
  settings: SettingsData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const lines = (purchase.items || []) as PurchaseLine[];
  const productMap = new Map(products.map((p) => [p.id, p]));
  const [methodId, setMethodId] = useState<string>(
    methods.find((m) => m.kind === "cash")?.id || methods[0]?.id || ""
  );
  const [serials, setSerials] = useState<Record<number, { serial: string; barcode: string }[]>>(() => {
    const init: Record<number, { serial: string; barcode: string }[]> = {};
    lines.forEach((l, i) => {
      const p = productMap.get(l.refId);
      if (p?.serial_tracked) init[i] = Array.from({ length: Number(l.qty) }, () => ({ serial: "", barcode: "" }));
    });
    return init;
  });

  function setUnit(lineIdx: number, unitIdx: number, key: "serial" | "barcode", v: string) {
    setSerials((prev) => {
      const next = { ...prev };
      const row = [...(next[lineIdx] || [])];
      row[unitIdx] = { ...row[unitIdx], [key]: v };
      next[lineIdx] = row;
      return next;
    });
  }

  const anySerialTracked = lines.some((l) => productMap.get(l.refId)?.serial_tracked);
  const isCash = purchase.purchase_type === "cash";
  const total = Number(purchase.total) || 0;
  const [paid, setPaid] = useState<number>(total);
  const paidPartial = isCash && paid < total - 0.01;

  function submit() {
    for (const [idxStr, units] of Object.entries(serials)) {
      const lineIdx = Number(idxStr);
      const lineName = lines[lineIdx]?.name || `Line ${lineIdx + 1}`;
      for (let u = 0; u < units.length; u++) {
        if (!units[u].serial.trim()) {
          toast.error(`${lineName}: serial #${u + 1} is required`);
          return;
        }
      }
      const seen = new Set<string>();
      for (const u of units) {
        const k = u.serial.trim();
        if (seen.has(k)) { toast.error(`${lineName}: duplicate serial "${k}"`); return; }
        seen.add(k);
      }
    }
    start(async () => {
      // One-step for a draft: confirm (mark ordered) first, then receive + pay.
      if (purchase.status === "draft") {
        const o = await markOrdered(purchase.id);
        if (!o.ok) { toast.error(o.error || "Could not confirm"); return; }
      }
      const r = await receivePurchase(
        purchase.id, serials,
        isCash ? paid : undefined,
        isCash ? (methodId || null) : null,
      );
      if (!r.ok) { toast.error(r.error || "Receive failed"); return; }
      toast.success(`PO ${purchase.po_no} received${isCash ? " & paid" : ""}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Receive{isCash ? " & Pay" : ""} PO {purchase.po_no}</DialogTitle>
          <DialogDescription>
            {anySerialTracked
              ? `Enter a serial number for each unit (must match the quantity)${isCash ? ", then confirm payment" : ""}.`
              : isCash
                ? "Confirm what you paid the supplier â€” any shortfall is kept as a balance owed."
                : "Confirm receipt - stock levels will be updated."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {lines.map((l, lineIdx) => {
            const p = productMap.get(l.refId);
            const tracked = !!p?.serial_tracked;
            return (
              <div key={lineIdx} className="border rounded-md p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="font-medium text-slate-900">{l.name}</div>
                    <div className="text-xs text-slate-500">
                      Qty {l.qty} - {tracked ? "serial-tracked" : "stock count only"}
                    </div>
                  </div>
                  {!tracked && <Badge variant="secondary">No serials needed</Badge>}
                </div>
                {tracked && (
                  <div className="grid grid-cols-12 gap-2 text-xs">
                    <div className="col-span-1 text-slate-500 font-medium">#</div>
                    <div className="col-span-6 text-slate-500 font-medium">Serial number *</div>
                    <div className="col-span-5 text-slate-500 font-medium">Barcode (optional)</div>
                    {(serials[lineIdx] || []).map((u, unitIdx) => (
                      <Fragment key={unitIdx}>
                        <div className="col-span-1 self-center text-slate-400 tabular-nums">{unitIdx + 1}</div>
                        <Input
                          className="col-span-6 font-mono h-9"
                          value={u.serial}
                          onChange={(e) => setUnit(lineIdx, unitIdx, "serial", e.target.value)}
                          placeholder="e.g. SN-000123"
                          autoFocus={lineIdx === 0 && unitIdx === 0}
                        />
                        <Input
                          className="col-span-5 font-mono h-9"
                          value={u.barcode}
                          onChange={(e) => setUnit(lineIdx, unitIdx, "barcode", e.target.value)}
                          placeholder="(scan or type)"
                        />
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {isCash && (
          <div className="border-t pt-3 mt-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="pay_from" className="m-0">Pay from</Label>
              <Select id="pay_from" className="h-9 w-48" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.length === 0 && <option value="">â€” Cash drawer â€”</option>}
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="paid_amount" className="m-0">Amount paid now</Label>
              <Input
                id="paid_amount" type="number" step="0.01" min="0"
                className="h-9 w-40 text-right tabular-nums font-semibold"
                value={paid}
                onChange={(e) => setPaid(Number(e.target.value) || 0)}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Total: {total.toFixed(2)}</span>
              {paidPartial
                ? <span className="text-amber-700 font-medium">Balance owed to supplier: {(total - paid).toFixed(2)}</span>
                : <span>Paid in full</span>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            Confirm Receive{isCash ? " & Pay" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c] || c);
}

/** Qty cell that keeps its own text while typing (so "1.5" doesn't lose the dot)
 *  and commits valid numbers up to the parent. */
function PurchaseQtyInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => { setStr(String(value)); }, [value]);
  return (
    <Input
      className="h-9 w-full text-center tabular-nums px-1"
      type="number" step="0.01" min="0"
      value={str}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setStr(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && !Number.isNaN(n)) onCommit(n);
      }}
      onBlur={() => { if (str === "" || Number.isNaN(Number(str))) { setStr(String(value)); onCommit(value); } }}
    />
  );
}

/** Open a printable, full-page A4 purchase order (header, supplier, lines, totals). */
function printPurchaseOrder(po: Purchase, supplier: Supplier | undefined, settings: SettingsData) {
  if (typeof window === "undefined") return;
  const sym = currencySymbol(settings);
  const win = window.open("", "_blank", "width=820,height=920");
  if (!win) { toast.error("Pop-up blocked â€” allow pop-ups to print the PO"); return; }
  const m = (v: number) => escapeHtml(formatMoney(v, sym));
  const company = settings.company?.name || "Purchase Order";
  const balance = Math.max(0, Number(po.total) - Number(po.amount_paid || 0));
  const taxName = settings.tax?.name || "Tax";
  const charges = Number(po.transport_cost || 0) + Number(po.other_charges || 0);
  const rows = (po.items || []).map((l, i) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#64748b">${i + 1}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(l.name)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${l.qty}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${m(l.price)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${m(Number(l.qty) * Number(l.price))}</td>
    </tr>`).join("");
  const html = `<!doctype html><html><head><title>PO ${escapeHtml(po.po_no)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:32px;max-width:780px;margin:0 auto}
      .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
      .brand{font-size:20px;font-weight:700}.muted{color:#64748b;font-size:12px}
      .title{font-size:24px;font-weight:700;letter-spacing:.02em;color:#b45309}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
      th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em;padding:8px;text-align:left}
      th.r,td.r{text-align:right}
      .totals{margin-top:16px;margin-left:auto;width:280px;font-size:13px}
      .totals .row{display:flex;justify-content:space-between;padding:4px 0}
      .totals .grand{border-top:2px solid #0f172a;margin-top:6px;padding-top:8px;font-weight:700;font-size:15px}
      .footer{margin-top:40px;color:#64748b;font-size:12px;border-top:1px solid #eee;padding-top:10px}
    </style></head><body>
    <div class="top">
      <div>
        <div class="brand">${escapeHtml(company)}</div>
        ${settings.company?.address ? `<div class="muted">${escapeHtml(settings.company.address)}</div>` : ""}
        ${settings.company?.phone ? `<div class="muted">Tel: ${escapeHtml(settings.company.phone)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div class="title">PURCHASE ORDER</div>
        <div class="muted" style="margin-top:4px">${escapeHtml(po.po_no)}</div>
        <div class="muted">${new Date(po.date).toLocaleDateString()}</div>
      </div>
    </div>
    <div class="muted" style="text-transform:uppercase;font-size:10px;letter-spacing:.06em">Supplier</div>
    <div style="font-weight:600;font-size:15px">${escapeHtml(supplier?.name || "â€”")}</div>
    ${supplier?.email ? `<div class="muted">${escapeHtml(supplier.email)}</div>` : ""}
    ${supplier?.phone ? `<div class="muted">${escapeHtml(supplier.phone)}</div>` : ""}
    <table>
      <thead><tr><th style="width:32px">#</th><th>Item</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span class="muted">Subtotal</span><span>${m(Number(po.subtotal))}</span></div>
      ${Number(po.discount) > 0 ? `<div class="row"><span class="muted">Discount</span><span>-${m(Number(po.discount))}</span></div>` : ""}
      ${Number(po.tax) > 0 ? `<div class="row"><span class="muted">${escapeHtml(taxName)} (${po.tax_rate}%)</span><span>${m(Number(po.tax))}</span></div>` : ""}
      ${charges > 0 ? `<div class="row"><span class="muted">Transport & charges</span><span>${m(charges)}</span></div>` : ""}
      <div class="row grand"><span>Total</span><span>${m(Number(po.total))}</span></div>
      ${Number(po.amount_paid) > 0 ? `<div class="row"><span class="muted">Paid</span><span>${m(Number(po.amount_paid))}</span></div>` : ""}
      ${balance > 0.001 ? `<div class="row" style="font-weight:600"><span>Balance due</span><span>${m(balance)}</span></div>` : ""}
    </div>
    <div class="footer">Generated by ${escapeHtml(company)}</div>
    <script>window.onload = () => { window.print(); };</script>
    </body></html>`;
  win.document.write(html);
  win.document.close();
}
