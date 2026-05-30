"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Pencil, Plus, Eye, X, CheckCircle2, DollarSign, Trash2, Wallet,
  Printer, Receipt as ReceiptIcon, Banknote, Package, AlertCircle,
  Loader2, Clock, FileEdit, Mail, Phone, User,
} from "lucide-react";
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

import type { Sale, SaleLine, SaleType, Product, Customer, PaymentMethod, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, formatDateTime, currencySymbol, computeLineTotals } from "@/lib/utils";
import {
  createSale, updateSale, deleteSale, confirmSale, cancelSale,
  recordSalePayment, bulkCancelSales, bulkDeleteSales, exportSales, listSaleUnits,
  type SaleReceipt,
} from "./actions";

type Mode = "view" | "edit" | "create" | "pay" | null;

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Unpaid" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];
const TYPE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "credit", label: "Credit" },
  { value: "invoice", label: "Invoice" },
];

function isOverdue(sale: Sale) {
  if (!sale.due_date) return false;
  if (sale.status === "paid" || sale.status === "cancelled") return false;
  return new Date(sale.due_date) < new Date(new Date().toISOString().slice(0, 10));
}

/* ========================================================================== */
/* MAIN LIST                                                                  */
/* ========================================================================== */
export function SalesClient({
  sales, totalCount, customers, products, methods, settings, permissions,
}: {
  sales: Sale[];
  totalCount: number;
  customers: Customer[];
  products: Product[];
  methods: PaymentMethod[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sp = useSearchParams();
  const [active, setActive] = useState<Sale | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const sym = currencySymbol(settings);

  const columns: Column<Sale>[] = [
    {
      key: "invoice_no", label: "Invoice", className: "w-[140px]",
      render: (r) => <span className="font-mono font-medium text-slate-900">{r.invoice_no}</span>,
    },
    { key: "date", label: "Date & time", className: "w-[150px] text-slate-600 whitespace-nowrap", render: (r) => formatDateTime(r.created_at) },
    {
      key: "customer", label: "Customer",
      render: (r) => {
        const c = customers.find((x) => x.id === r.customer_id);
        return c ? (
          <div>
            <div className="font-medium text-slate-900">{c.name}</div>
            {c.email && <div className="text-xs text-slate-500">{c.email}</div>}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      key: "sale_type", label: "Type", className: "w-[100px]",
      render: (r) => <TypeBadge type={r.sale_type} />,
    },
    {
      key: "total", label: "Total", className: "w-[120px] text-right",
      render: (r) => <span className="tabular-nums font-medium text-slate-900">{formatMoney(r.total, sym)}</span>,
    },
    {
      key: "balance", label: "Balance", className: "w-[120px] text-right",
      render: (r) => {
        const bal = Number(r.total) - Number(r.amount_paid || 0);
        if (r.status === "cancelled") return <span className="text-slate-400">—</span>;
        if (bal <= 0.001) return <span className="text-emerald-700 text-xs font-medium">Paid in full</span>;
        return (
          <span className={`tabular-nums ${isOverdue(r) ? "text-red-600 font-semibold" : "text-slate-700 font-medium"}`}>
            {formatMoney(bal, sym)}
          </span>
        );
      },
    },
    {
      key: "status", label: "Status", className: "w-[140px]",
      render: (r) => <StatusBadge sale={r} />,
    },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: STATUS_OPTIONS },
    { key: "sale_type", label: "Type", options: TYPE_OPTIONS },
    {
      key: "customer_id", label: "Customer",
      options: customers.map((c) => ({ value: c.id, label: c.name })),
    },
  ];

  const bulkActions: BulkAction<Sale>[] = [];
  if (can(permissions, "sales", "edit")) {
    bulkActions.push({
      label: "Cancel", icon: X, variant: "outline",
      run: (rows) => bulkCancelSales(rows.map((r) => r.id)),
    });
  }
  if (can(permissions, "sales", "delete")) {
    bulkActions.push({
      label: "Delete", icon: Trash2, variant: "destructive",
      run: (rows) => bulkDeleteSales(rows.map((r) => r.id)),
    });
  }

  return (
    <div>
      <PageHeader title="Sales" description="Cash, credit, and invoice transactions">
        <ExportButton
          action={() =>
            exportSales(
              sp.get("q") || undefined, sp.get("status") || undefined, sp.get("sale_type") || undefined,
              sp.get("customer_id") || undefined, sp.get("from") || undefined, sp.get("to") || undefined,
            )
          }
        />
        {can(permissions, "sales", "create") && (
          <Button size="sm" onClick={() => { setActive(null); setMode("create"); }}>
            <Plus className="h-4 w-4" /> New Sale
          </Button>
        )}
      </PageHeader>

      <DataTable<Sale>
        columns={columns}
        data={sales}
        totalCount={totalCount}
        searchPlaceholder="Search by invoice number..."
        filters={filters}
        bulkActions={bulkActions}
        rowActions={(row) => (
          <SalesRowActions
            row={row} permissions={permissions}
            onView={() => { setActive(row); setMode("view"); }}
            onEdit={() => { setActive(row); setMode("edit"); }}
            onPay={() => { setActive(row); setMode("pay"); }}
          />
        )}
      />

      {mode === "create" && (
        <SaleEditor
          sale={null} customers={customers} products={products} settings={settings}
          onClose={() => setMode(null)}
          onCashSuccess={(r) => { setMode(null); setReceipt(r); }}
        />
      )}
      {mode === "edit" && active && (
        <SaleEditor
          sale={active} customers={customers} products={products} settings={settings}
          onClose={() => { setMode(null); setActive(null); }}
          onCashSuccess={(r) => { setMode(null); setActive(null); setReceipt(r); }}
        />
      )}
      {mode === "view" && active && (
        <SaleViewer
          sale={active} customers={customers} settings={settings}
          permissions={permissions}
          onClose={() => { setMode(null); setActive(null); }}
          onEdit={() => setMode("edit")}
          onPay={() => setMode("pay")}
        />
      )}
      {mode === "pay" && active && (
        <PaymentDialog
          sale={active} settings={settings} methods={methods}
          onClose={() => { setMode(null); setActive(null); }}
        />
      )}
      {receipt && (
        <SaleReceiptDialog r={receipt} settings={settings} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}

/* ========================================================================== */
/* BADGES                                                                     */
/* ========================================================================== */
function TypeBadge({ type }: { type: SaleType }) {
  const config = {
    cash: { variant: "success" as const, label: "Cash" },
    credit: { variant: "warning" as const, label: "Credit" },
    invoice: { variant: "info" as const, label: "Invoice" },
  }[type];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function StatusBadge({ sale }: { sale: Sale }) {
  if (isOverdue(sale)) {
    return (
      <Badge variant="danger" className="gap-1">
        <Clock className="h-3 w-3" /> Overdue
      </Badge>
    );
  }
  const map: Record<
    string,
    { variant: "secondary" | "info" | "success" | "danger" | "warning"; label: string; icon?: React.ElementType }
  > = {
    draft: { variant: "secondary", label: "Draft", icon: FileEdit },
    confirmed: { variant: "warning", label: "Unpaid", icon: AlertCircle },
    paid: { variant: "success", label: "Paid", icon: CheckCircle2 },
    cancelled: { variant: "danger", label: "Cancelled", icon: X },
  };
  const cfg = map[sale.status] || map.draft;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      {Icon && <Icon className="h-3 w-3" />}
      {cfg.label}
    </Badge>
  );
}

/* ========================================================================== */
/* ROW ACTIONS                                                                */
/* ========================================================================== */
function SalesRowActions({
  row, permissions, onView, onEdit, onPay,
}: {
  row: Sale; permissions: PermissionMatrix;
  onView: () => void; onEdit: () => void; onPay: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(success);
      router.refresh();
    });
  }
  const isCash = row.sale_type === "cash";
  return (
    <>
      <Button variant="ghost" size="icon" onClick={onView} title="View" className="h-8 w-8">
        <Eye className="h-4 w-4" />
      </Button>
      {row.status === "draft" && can(permissions, "sales", "edit") && (
        <>
          <Button variant="ghost" size="icon" onClick={onEdit} title="Edit" className="h-8 w-8">
            <Pencil className="h-4 w-4" />
          </Button>
          {/* Cash sales auto-confirm at create time, so no manual confirm button. */}
          {!isCash && (
            <Button
              variant="ghost" size="icon" disabled={pending}
              onClick={() => run(() => confirmSale(row.id), "Sale confirmed")}
              title="Confirm sale" className="h-8 w-8 text-blue-600"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          )}
        </>
      )}
      {row.status === "confirmed" && !isCash && can(permissions, "sales", "edit") && (
        <Button
          variant="ghost" size="icon" disabled={pending} onClick={onPay}
          title="Record payment" className="h-8 w-8 text-emerald-600"
        >
          <Wallet className="h-4 w-4" />
        </Button>
      )}
      {row.status !== "cancelled" && can(permissions, "sales", "edit") && (
        <Button
          variant="ghost" size="icon" disabled={pending}
          onClick={() => run(() => cancelSale(row.id), "Sale cancelled")}
          title="Cancel sale" className="h-8 w-8 text-amber-600"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      {can(permissions, "sales", "delete") && (
        <DeleteButton
          action={() => deleteSale(row.id)}
          message="Stock will be restored if this sale was confirmed/paid."
        />
      )}
    </>
  );
}

/* ========================================================================== */
/* PAYMENT DIALOG (credit / invoice sales)                                    */
/* ========================================================================== */
function PaymentDialog({
  sale, settings, methods, onClose,
}: { sale: Sale; settings: SettingsData; methods: PaymentMethod[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const balance = Number(sale.total) - Number(sale.amount_paid || 0);
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [methodId, setMethodId] = useState<string>(methods[0]?.id || "");
  const [reference, setReference] = useState("");
  const sym = currencySymbol(settings);
  const method = methods.find((m) => m.id === methodId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!methodId) { toast.error("Select payment method"); return; }
    if (method?.requires_ref && !reference.trim()) { toast.error("Reference required for this method"); return; }
    start(async () => {
      const r = await recordSalePayment(sale.id, Number(amount), methodId, reference || null);
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
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-600" />
            Record Payment
          </DialogTitle>
          <DialogDescription>
            Invoice <span className="font-mono font-medium">{sale.invoice_no}</span> · Outstanding{" "}
            <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(balance, sym)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="amt">Payment Amount *</Label>
            <Input
              id="amt" type="number" step="0.01" min="0.01" max={balance.toFixed(2)}
              value={amount} onChange={(e) => setAmount(e.target.value)} required
              className="text-lg h-11 tabular-nums font-semibold"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAmount(balance.toFixed(2))}>
              Pay full
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAmount((balance / 2).toFixed(2))}>
              Pay half
            </Button>
          </div>
          <div>
            <Label htmlFor="method">Payment Method *</Label>
            <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)} required>
              <option value="">— Select —</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
          {method?.requires_ref && (
            <div>
              <Label htmlFor="ref">Reference *</Label>
              <Input
                id="ref" value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder={method.kind === "mpesa" ? "M-Pesa code" : "Reference number"} required
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> Recording...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" /> Record Payment
                </span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ========================================================================== */
/* SALE VIEWER — invoice-style preview                                        */
/* ========================================================================== */
function SaleViewer({
  sale, customers, settings, permissions, onClose, onEdit, onPay,
}: {
  sale: Sale; customers: Customer[]; settings: SettingsData;
  permissions: PermissionMatrix;
  onClose: () => void; onEdit: () => void; onPay: () => void;
}) {
  const customer = customers.find((c) => c.id === sale.customer_id);
  const sym = currencySymbol(settings);
  const balance = Number(sale.total) - Number(sale.amount_paid || 0);
  const company = settings.company;
  const taxName = settings.tax?.name || "Tax";
  const isCash = sale.sale_type === "cash";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* Header strip */}
        <DialogHeader className="px-6 py-4 border-b bg-slate-50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <DialogTitle className="text-lg flex items-center gap-3 flex-wrap">
              <span>Sale</span>
              <span className="font-mono text-base text-slate-900">{sale.invoice_no}</span>
              <TypeBadge type={sale.sale_type} />
              <StatusBadge sale={sale} />
            </DialogTitle>
            <DialogDescription className="sr-only">Sale details for {sale.invoice_no}</DialogDescription>
          </div>
        </DialogHeader>

        {/* Invoice-style body */}
        <div className="px-6 py-5 space-y-5">
          {/* Company + meta */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 sm:col-span-7">
              <div className="text-lg font-bold text-slate-900">{company?.name || "—"}</div>
              {company?.address && <div className="text-sm text-slate-600">{company.address}</div>}
              {company?.phone && <div className="text-sm text-slate-600">Tel: {company.phone}</div>}
              {company?.email && <div className="text-sm text-slate-600">{company.email}</div>}
              {settings.tax?.registrationNo && (
                <div className="text-sm text-slate-600">Tax No: {settings.tax.registrationNo}</div>
              )}
            </div>
            <div className="col-span-12 sm:col-span-5 sm:text-right space-y-0.5 text-sm">
              <div className="sm:flex sm:justify-end sm:gap-3">
                <span className="text-slate-500">Date:</span>{" "}
                <span className="font-medium text-slate-900">{formatDate(sale.date)}</span>
              </div>
              {sale.due_date && (
                <div className="sm:flex sm:justify-end sm:gap-3">
                  <span className="text-slate-500">Due:</span>{" "}
                  <span className={`font-medium ${isOverdue(sale) ? "text-red-600" : "text-slate-900"}`}>
                    {formatDate(sale.due_date)}
                  </span>
                </div>
              )}
              {Number(sale.amount_paid) > 0 && (
                <div className="sm:flex sm:justify-end sm:gap-3">
                  <span className="text-slate-500">Paid:</span>{" "}
                  <span className="font-medium text-emerald-700">{formatMoney(sale.amount_paid, sym)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Bill to */}
          <div className="border rounded-lg p-4 bg-slate-50">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Bill to</div>
            <div className="font-semibold text-slate-900">{customer?.name || "—"}</div>
            {(customer?.email || customer?.phone || customer?.city) && (
              <div className="text-sm text-slate-600 mt-0.5">
                {[customer?.email, customer?.phone, customer?.city].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="text-left p-3 w-10">#</th>
                  <th className="text-left p-3">Item</th>
                  <th className="text-right p-3 w-20">Qty</th>
                  <th className="text-right p-3 w-28">Rate</th>
                  <th className="text-right p-3 w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(sale.items || []).map((l, i) => (
                  <tr key={i} className="border-t hover:bg-slate-50">
                    <td className="p-3 text-slate-400">{i + 1}</td>
                    <td className="p-3 font-medium text-slate-900">{l.name}</td>
                    <td className="p-3 text-right tabular-nums">{l.qty}</td>
                    <td className="p-3 text-right tabular-nums">{formatMoney(l.price, sym)}</td>
                    <td className="p-3 text-right font-semibold tabular-nums">
                      {formatMoney(Number(l.qty) * Number(l.price), sym)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span className="tabular-nums">{formatMoney(sale.subtotal, sym)}</span>
              </div>
              {Number(sale.discount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Discount</span>
                  <span className="tabular-nums text-red-600">−{formatMoney(sale.discount, sym)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">{taxName} ({sale.tax_rate}%)</span>
                <span className="tabular-nums">{formatMoney(sale.tax, sym)}</span>
              </div>
              <div className="flex justify-between font-bold text-base pt-2 mt-1 border-t-2 border-slate-300">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(sale.total, sym)}</span>
              </div>
              {!isCash && (
                <>
                  <div className="flex justify-between text-emerald-700">
                    <span>Amount Paid</span>
                    <span className="tabular-nums">{formatMoney(sale.amount_paid, sym)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold rounded-md px-2 py-1.5 ${
                    balance > 0.001 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                  }`}>
                    <span>Balance</span>
                    <span className="tabular-nums">{formatMoney(balance, sym)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {sale.notes && (
            <div className="border-t pt-3 text-sm">
              <span className="font-semibold text-slate-700">Notes: </span>
              <span className="text-slate-600">{sale.notes}</span>
            </div>
          )}
        </div>

        {/* Action bar */}
        <DialogFooter className="px-6 py-3 border-t bg-slate-50 sm:justify-between">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <div className="flex gap-2">
            {sale.status === "draft" && can(permissions, "sales", "edit") && (
              <Button variant="outline" onClick={onEdit}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {sale.status === "confirmed" && !isCash && can(permissions, "sales", "edit") && (
              <Button onClick={onPay}>
                <Wallet className="h-4 w-4" /> Record Payment
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ========================================================================== */
/* SALE EDITOR — QuickBooks/Sage-style invoice form                           */
/* ========================================================================== */
function SaleEditor({
  sale, customers, products, settings, onClose, onCashSuccess,
}: {
  sale: Sale | null;
  customers: Customer[];
  products: Product[];
  settings: SettingsData;
  onClose: () => void;
  onCashSuccess: (r: SaleReceipt) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);
  const [lines, setLines] = useState<SaleLine[]>(sale?.items || []);
  const [serialPick, setSerialPick] = useState<{ index: number; product: Product } | null>(null);
  const [discount, setDiscount] = useState(Number(sale?.discount ?? 0));
  const [taxRate, setTaxRate] = useState(Number(sale?.tax_rate ?? settings.tax?.defaultRate ?? 0));
  const [saleType, setSaleType] = useState<SaleType>(sale?.sale_type || "cash");
  const [customerId, setCustomerId] = useState<string>(sale?.customer_id || "");
  // Cash payment state: tendered defaults to total and stays in sync until user edits it
  const [tendered, setTendered] = useState<number>(0);
  const [tenderedTouched, setTenderedTouched] = useState(false);

  // Inclusive vs exclusive: settings.tax.inclusive controls whether the line
  // prices already include tax (back out) or have tax added on top.
  const taxInclusive = !!settings.tax?.inclusive;
  const totals = useMemo(
    () => computeLineTotals(lines, discount, taxRate, taxInclusive),
    [lines, discount, taxRate, taxInclusive],
  );

  useEffect(() => {
    if (!tenderedTouched) setTendered(totals.total);
  }, [totals.total, tenderedTouched]);

  const quickChips = useMemo(() => {
    if (totals.total <= 0) return [] as number[];
    const denoms = settings.pos?.quickAmounts && settings.pos.quickAmounts.length > 0
      ? settings.pos.quickAmounts
      : [50, 100, 200, 500, 1000, 2000];
    const ceil = (n: number) => Math.ceil(totals.total / n) * n;
    return Array.from(new Set([
      totals.total,
      ...denoms.filter((d) => d >= totals.total),
      ceil(50), ceil(100), ceil(500), ceil(1000),
    ])).sort((a, b) => a - b).slice(0, 6);
  }, [settings.pos?.quickAmounts, totals.total]);

  const isNewCash = saleType === "cash" && !sale;
  const change = Math.max(0, Math.round((tendered - totals.total) * 100) / 100);
  // Paying less than the total is allowed — the rest becomes a balance (AR).
  const partial = isNewCash && tendered < totals.total - 0.01;
  const balance = partial ? Math.round((totals.total - tendered) * 100) / 100 : 0;
  const taxName = settings.tax?.name || "Tax";
  const selectedCustomer = customers.find((c) => c.id === customerId);

  // --- Blockers: serial units not picked, or credit over the limit ----------
  const serialIncompleteLine = lines.find((l) => {
    if (!l.refId) return false;
    const prod = products.find((p) => p.id === l.refId);
    return prod?.serial_tracked && (l.unit_ids?.length ?? 0) !== Number(l.qty);
  });
  const serialBlocked = !!serialIncompleteLine;

  // The unpaid portion of this sale is the credit being taken now.
  const paidNowUI = saleType === "cash" ? Math.min(tendered, totals.total) : 0;
  const creditPortion = Math.max(0, Math.round((totals.total - paidNowUI) * 100) / 100);
  const creditLimit = Number(selectedCustomer?.credit_limit || 0);
  const creditOutstanding = Number(selectedCustomer?.balance || 0);
  const creditExceeded = !sale && creditLimit > 0 && creditPortion > 0.01 &&
    (creditOutstanding + creditPortion > creditLimit + 0.01);

  const blockReason = serialBlocked
    ? `Pick the serial unit(s) for "${serialIncompleteLine?.name || "line"}" before saving.`
    : creditExceeded
      ? `Over credit limit for ${selectedCustomer?.name ?? "customer"}: limit ${formatMoney(creditLimit, sym)}, ` +
        `owed ${formatMoney(creditOutstanding, sym)}, this credit ${formatMoney(creditPortion, sym)}. ` +
        `Collect more cash now or raise the limit.`
      : null;
  const blocked = serialBlocked || creditExceeded;

  function addLineAfter(index: number) {
    const blank: SaleLine = { refId: "", name: "", qty: 1, price: 0 };
    if (index < 0) setLines([...lines, blank]);
    else setLines([...lines.slice(0, index + 1), blank, ...lines.slice(index + 1)]);
  }

  function pickProduct(index: number, productId: string) {
    if (!productId) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const dupIndex = lines.findIndex((l, i) => i !== index && l.refId === productId);
    if (dupIndex >= 0) {
      const next = [...lines];
      const addQty = Number(next[index].qty) || 1;
      next[dupIndex] = { ...next[dupIndex], qty: Number(next[dupIndex].qty) + addQty };
      next.splice(index, 1);
      setLines(next);
      toast.info(`Added ${addQty} to existing ${product.name}`);
      return;
    }
    const next = [...lines];
    next[index] = {
      refId: product.id,
      name: product.name,
      qty: Number(next[index].qty) || 1,
      price: Number(product.selling_price),
    };
    setLines(next);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const filled = lines.filter((l) => l.refId);
    if (!filled.length) { toast.error("Add at least one product line"); return; }
    if (!customerId) { toast.error("Select a customer"); return; }
    if (blocked && blockReason) { toast.error(blockReason); return; }

    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(filled));
    fd.set("customer_id", customerId);
    if (isNewCash) {
      fd.set("tendered", String(tendered));
      // Amount applied to the bill now (capped at total server-side); any
      // shortfall is left as a balance owed by the customer.
      fd.set("paid", String(tendered));
    }

    start(async () => {
      const r = sale ? await updateSale(sale.id, fd) : await createSale(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(sale ? "Sale updated" : (r.receipt ? "Cash sale completed" : "Sale created"));
      if (r.receipt) {
        onCashSuccess(r.receipt);
        router.refresh();
      } else {
        onClose();
        router.refresh();
      }
    });
  }

  const productOptions: ComboboxOption[] = products.map((p) => ({
    value: p.id,
    label: p.name,
    sub: `${p.code} · Stock: ${p.current_stock} · ${formatMoney(p.selling_price, sym)}`,
  }));

  const customerOptions: ComboboxOption[] = customers.map((c) => ({
    value: c.id,
    label: c.name,
    sub: c.email || c.phone || c.code,
  }));

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* Sticky header with live total */}
        <DialogHeader className="px-6 py-4 border-b bg-white sticky top-0 z-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <DialogTitle className="text-xl flex items-center gap-3 flex-wrap">
                {sale ? "Edit Sale" : "New Sale"}
                {sale && <span className="font-mono text-base text-slate-500 font-normal">{sale.invoice_no}</span>}
                {sale && <StatusBadge sale={sale} />}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {sale ? "Update sale details" : "Fill in customer, items, and totals to create a new sale"}
              </DialogDescription>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wide font-medium">Total</div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums">{formatMoney(totals.total, sym)}</div>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="px-6 py-5 space-y-6">
          {/* ----- SECTION 1: Customer & Details ----- */}
          <section>
            <SectionTitle>Customer &amp; Details</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-7">
                <Label>Customer *</Label>
                <Combobox
                  value={customerId}
                  onChange={setCustomerId}
                  options={customerOptions}
                  placeholder="Search customer by name, email, code..."
                  emptyText="No customers match"
                />
                {selectedCustomer && (
                  <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-sm flex items-start gap-2">
                    <User className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900">{selectedCustomer.name}</div>
                      <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {selectedCustomer.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" />{selectedCustomer.email}
                          </span>
                        )}
                        {selectedCustomer.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />{selectedCustomer.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="col-span-12 md:col-span-5 grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="invoice_no">Invoice #</Label>
                  <Input
                    id="invoice_no" name="invoice_no"
                    defaultValue={sale?.invoice_no || ""}
                    placeholder="(auto)" readOnly={!!sale}
                  />
                </div>
                <div>
                  <Label htmlFor="date">Date *</Label>
                  <Input
                    id="date" name="date" type="date"
                    defaultValue={sale?.date || new Date().toISOString().slice(0, 10)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="sale_type">Sale Type *</Label>
                  <Select
                    id="sale_type" name="sale_type"
                    value={saleType} onChange={(e) => setSaleType(e.target.value as SaleType)}
                    required
                  >
                    <option value="cash">Cash (auto-paid)</option>
                    <option value="credit">Credit (track balance)</option>
                    <option value="invoice">Invoice (with due date)</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="due_date">Due Date</Label>
                  <Input
                    id="due_date" name="due_date" type="date"
                    disabled={saleType !== "invoice"}
                    defaultValue={sale?.due_date || ""}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ----- SECTION 2: Line items table ----- */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle className="m-0">Items</SectionTitle>
              {lines.length > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => addLineAfter(lines.length - 1)}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              )}
            </div>
            <div className="border rounded-lg overflow-hidden bg-white">
              {/* Column headers */}
              <div className="grid grid-cols-[36px_minmax(0,1fr)_90px_120px_120px_36px] gap-2 px-3 py-2 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                <div className="text-center">#</div>
                <div>Product / Service</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Rate</div>
                <div className="text-right">Amount</div>
                <div></div>
              </div>

              {lines.length === 0 ? (
                <div className="px-3 py-10 text-center bg-white">
                  <Package className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm text-slate-500 mb-3">No items added yet</p>
                  <Button type="button" size="sm" onClick={() => addLineAfter(-1)}>
                    <Plus className="h-3.5 w-3.5" /> Add first item
                  </Button>
                </div>
              ) : (
                lines.map((l, i) => {
                  const prod = products.find((p) => p.id === l.refId);
                  const serial = !!prod?.serial_tracked;
                  const picked = l.unit_ids?.length ?? 0;
                  return (
                  <div key={i} className="border-t bg-white hover:bg-slate-50">
                    <div className="grid grid-cols-[36px_minmax(0,1fr)_90px_120px_120px_36px] gap-2 px-3 py-2 items-center">
                    <div className="text-center text-xs text-slate-400 font-medium">{i + 1}</div>
                    <Combobox
                      value={l.refId}
                      onChange={(v) => pickProduct(i, v)}
                      options={productOptions}
                      placeholder="Search product..."
                    />
                    <Input
                      className="h-9 text-right tabular-nums"
                      type="number" step="0.01" min="0"
                      value={l.qty}
                      readOnly={serial}
                      title={serial ? "Quantity is set by the serial units you select" : undefined}
                      onChange={(e) => {
                        const next = [...lines]; next[i] = { ...next[i], qty: Number(e.target.value) || 0 }; setLines(next);
                      }}
                    />
                    <Input
                      className="h-9 text-right tabular-nums"
                      type="number" step="0.01" min="0"
                      value={l.price}
                      onChange={(e) => {
                        const next = [...lines]; next[i] = { ...next[i], price: Number(e.target.value) || 0 }; setLines(next);
                      }}
                    />
                    <div className="text-right font-semibold tabular-nums text-slate-900 px-1">
                      {formatMoney(Number(l.qty) * Number(l.price), sym)}
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon" title="Remove line"
                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 mx-auto"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    </div>
                    {serial && (
                      <div className="px-3 pb-2 flex items-center justify-between gap-2">
                        <span className={`text-xs font-medium ${picked > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                          {picked} serial unit(s) selected
                        </span>
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => prod && setSerialPick({ index: i, product: prod })}>
                          Select serial numbers
                        </Button>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>
          </section>

          {/* ----- SECTION 3: Notes + Totals (with inline cash payment) ----- */}
          <section className="grid grid-cols-12 gap-6">
            <div className="col-span-12 md:col-span-7">
              <SectionTitle>Notes / Memo</SectionTitle>
              <Textarea
                id="notes" name="notes" rows={6}
                defaultValue={sale?.notes ?? ""}
                placeholder="Internal notes about this sale (not printed on receipt)"
                className="resize-none"
              />
            </div>
            <div className="col-span-12 md:col-span-5">
              <SectionTitle>Summary</SectionTitle>
              <div className="bg-white border rounded-lg p-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="tabular-nums font-medium">{formatMoney(totals.subtotal, sym)}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <Label htmlFor="discount" className="text-slate-600 font-normal m-0">Discount</Label>
                  <Input
                    id="discount" name="discount"
                    className="h-8 w-28 text-right tabular-nums"
                    type="number" step="0.01" min="0"
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="flex justify-between items-center gap-2">
                  <Label htmlFor="tax_rate" className="text-slate-600 font-normal m-0">
                    {taxName} Rate (%){taxInclusive && <span className="text-[10px] text-slate-400 ml-1">incl.</span>}
                  </Label>
                  <Input
                    id="tax_rate" name="tax_rate"
                    className="h-8 w-28 text-right tabular-nums"
                    type="number" step="0.01" min="0"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{taxName} amount{taxInclusive ? " (of which)" : ""}</span>
                  <span className="tabular-nums">{formatMoney(totals.tax, sym)}</span>
                </div>
                <div className="border-t-2 border-slate-300 pt-2.5 mt-2 flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(totals.total, sym)}</span>
                </div>

                {isNewCash && (
                  <div className="border-t-2 border-dashed border-slate-300 pt-3 mt-3 space-y-2.5">
                    <div className="flex justify-between items-center gap-2">
                      <Label htmlFor="tendered" className="font-semibold text-slate-700 m-0">Amount Paid</Label>
                      <Input
                        id="tendered"
                        className="h-9 w-36 text-right tabular-nums font-bold text-base"
                        type="number" step="0.01" min="0"
                        value={tendered}
                        onChange={(e) => { setTendered(Number(e.target.value) || 0); setTenderedTouched(true); }}
                      />
                    </div>
                    {quickChips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {quickChips.map((v) => (
                          <Button
                            key={v}
                            type="button" size="sm"
                            variant={tendered === v ? "default" : "outline"}
                            className="h-7 px-2 text-xs tabular-nums"
                            onClick={() => { setTendered(v); setTenderedTouched(true); }}
                          >
                            {formatMoney(v, sym)}
                          </Button>
                        ))}
                      </div>
                    )}
                    <div className={`flex justify-between items-center rounded-md p-3 font-bold ${
                      partial ? "bg-amber-50 text-amber-700 border border-amber-200" :
                      change > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                      "bg-slate-100 text-slate-700"
                    }`}>
                      <span className="flex items-center gap-2">
                        {partial ? <AlertCircle className="h-4 w-4" /> : change > 0 ? <CheckCircle2 className="h-4 w-4" /> : null}
                        {partial ? "Balance due" : "Change"}
                      </span>
                      <span className="tabular-nums text-lg">
                        {formatMoney(partial ? balance : change, sym)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Reason the save/charge button is disabled */}
          {blockReason && (
            <div className="-mx-6 px-6 py-2 bg-red-50 border-t border-red-200 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {blockReason}
            </div>
          )}

          {/* Sticky footer with primary action */}
          <DialogFooter className="-mx-6 -mb-5 px-6 py-4 border-t bg-slate-50 sm:justify-between sticky bottom-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || blocked} size="lg">
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </span>
              ) : isNewCash ? (
                <span className="inline-flex items-center gap-2">
                  <Banknote className="h-5 w-5" /> Charge {formatMoney(totals.total, sym)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <DollarSign className="h-5 w-5" /> {sale ? "Save changes" : "Save sale"}
                </span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {serialPick && (
      <SerialPickDialog
        product={serialPick.product}
        existingIds={lines[serialPick.index]?.unit_ids ?? []}
        sym={sym}
        onClose={() => setSerialPick(null)}
        onConfirm={(ids) => {
          setLines((prev) => {
            const next = [...prev];
            next[serialPick.index] = { ...next[serialPick.index], unit_ids: ids, qty: ids.length };
            return next;
          });
          setSerialPick(null);
        }}
      />
    )}
    </>
  );
}

/* ========================================================================== */
/* SERIAL PICKER (sales)                                                       */
/* ========================================================================== */
function SerialPickDialog({
  product, existingIds, sym, onConfirm, onClose,
}: {
  product: Product;
  existingIds: string[];
  sym: string;
  onConfirm: (unitIds: string[]) => void;
  onClose: () => void;
}) {
  const [units, setUnits] = useState<{ id: string; serial_no: string; barcode: string | null; cost: number }[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(existingIds);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listSaleUnits(product.id, search).then((r) => {
      setUnits(r.ok ? (r.units || []) : []);
      setLoading(false);
    });
  }, [product.id, search]);

  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select serial units — {product.name}</DialogTitle>
          <DialogDescription>Pick which serial-numbered units are being sold. Selected: {selected.length}</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by serial or barcode..." className="font-mono" />
        <div className="max-h-[360px] overflow-y-auto border rounded-md mt-2">
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-1" /> Loading units…
            </div>
          ) : units.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No matching units in stock.</div>
          ) : (
            units.map((u) => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 border-t cursor-pointer hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4 accent-blue-600"
                  checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="flex-1 min-w-0">
                  <span className="block font-mono text-sm truncate">{u.serial_no}</span>
                  {u.barcode && <span className="block text-xs text-slate-500 truncate">{u.barcode}</span>}
                </span>
                <span className="text-xs tabular-nums text-slate-500">{formatMoney(u.cost, sym)}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => onConfirm(selected)}>Use {selected.length} unit(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Consistent section heading used throughout the editor + viewer. */
function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 ${className ?? ""}`}>
      {children}
    </h3>
  );
}

/* ========================================================================== */
/* RECEIPT DIALOG — shown after a successful cash sale; supports print        */
/* ========================================================================== */
function SaleReceiptDialog({
  r, settings, onClose,
}: {
  r: SaleReceipt;
  settings: SettingsData;
  onClose: () => void;
}) {
  const sym = currencySymbol(settings);
  const company = settings.company?.name || "Receipt";
  const address = settings.company?.address || "";
  const phone = settings.company?.phone || "";
  const taxNo = settings.tax?.registrationNo || "";
  const footer = settings.receipt?.footer || "Thank you for your business!";

  function moneyStr(v: number) {
    return formatMoney(v, sym);
  }

  function printReceipt() {
    if (typeof window === "undefined") return;
    const win = window.open("", "_blank", "width=320,height=600");
    if (!win) { toast.error("Pop-up blocked — please allow pop-ups to print"); return; }
    const html = `<!doctype html><html><head><title>${escapeHtml(r.invoice_no)}</title>
      <style>
        body { font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; }
        h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
        .center { text-align: center; }
        .row { display: flex; justify-content: space-between; padding: 2px 0; }
        .total { border-top: 1px dashed #999; margin-top: 6px; padding-top: 6px; font-weight: bold; font-size: 13px; }
        .change { border: 1px dashed #333; margin-top: 4px; padding: 4px; font-weight: bold; }
        .small { color: #555; font-size: 11px; }
        .footer { text-align: center; margin-top: 12px; padding-top: 6px; border-top: 1px dashed #999; }
      </style></head><body>
      <h1>${escapeHtml(company)}</h1>
      ${address ? `<div class="center small">${escapeHtml(address)}</div>` : ""}
      ${phone ? `<div class="center small">Tel: ${escapeHtml(phone)}</div>` : ""}
      ${taxNo ? `<div class="center small">Tax No: ${escapeHtml(taxNo)}</div>` : ""}
      <div style="margin-top:8px;">
        <div class="row"><span>Invoice</span><span>${escapeHtml(r.invoice_no)}</span></div>
        ${r.payment_no ? `<div class="row"><span>Payment</span><span>${escapeHtml(r.payment_no)}</span></div>` : ""}
        <div class="row small"><span>${new Date(r.date).toLocaleString()}</span></div>
        ${r.method_name ? `<div class="row"><span>Method</span><span>${escapeHtml(r.method_name)}</span></div>` : ""}
      </div>
      <div class="row total"><span>Total</span><span>${escapeHtml(moneyStr(r.total))}</span></div>
      ${r.tendered != null ? `<div class="row"><span>Tendered</span><span>${escapeHtml(moneyStr(r.tendered))}</span></div>` : ""}
      ${r.change_due && r.change_due > 0 ? `<div class="row change"><span>Change</span><span>${escapeHtml(moneyStr(r.change_due))}</span></div>` : ""}
      <p class="footer small">${escapeHtml(footer)}</p>
      <script>window.onload = () => { window.print(); };</script>
      </body></html>`;
    win.document.write(html);
    win.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" />
          </div>
          <DialogTitle className="text-xl text-slate-900 mt-2 text-center">Sale completed</DialogTitle>
          <DialogDescription className="text-center">Receipt is ready to print.</DialogDescription>
        </DialogHeader>

        <div className="bg-slate-50 rounded-lg p-4 my-2 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice</span>
            <span className="font-mono font-medium">{r.invoice_no}</span>
          </div>
          {r.payment_no && (
            <div className="flex justify-between">
              <span className="text-slate-500">Payment</span>
              <span className="font-mono font-medium">{r.payment_no}</span>
            </div>
          )}
          {r.method_name && (
            <div className="flex justify-between">
              <span className="text-slate-500">Method</span>
              <span className="font-medium">{r.method_name}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 mt-1 border-t border-slate-200">
            <span className="text-slate-700 font-medium">Total</span>
            <span className="text-lg font-bold text-blue-700">{formatMoney(r.total, sym)}</span>
          </div>
          {r.tendered != null && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Tendered</span>
              <span className="font-mono">{formatMoney(r.tendered, sym)}</span>
            </div>
          )}
          {r.change_due != null && r.change_due > 0 && (
            <div className="flex justify-between bg-emerald-50 rounded px-2 py-1.5">
              <span className="text-emerald-800 font-semibold">Change</span>
              <span className="font-bold text-emerald-700 text-base tabular-nums">{formatMoney(r.change_due, sym)}</span>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={printReceipt} className="flex-1">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={onClose} className="flex-1">
            <ReceiptIcon className="h-4 w-4" /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return s.replace(/[&<>"']/g, (c) => map[c] || c);
}
