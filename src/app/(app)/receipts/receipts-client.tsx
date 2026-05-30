"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Receipt, Printer, Eye, Plus, ChevronDown,
  Wallet, PiggyBank, Banknote,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";

import type { Payment, Sale, Customer, PaymentMethod, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, formatDateTime, currencySymbol } from "@/lib/utils";
import { recordPayment, recordCustomerDeposit, recordOtherIncome } from "../payments/actions";

type OpenSale = { id: string; invoice_no: string; date: string; due_date: string | null; total: number; amount_paid: number; customer_id: string | null; sale_type: string };
type IncomeAccount = { code: string; name: string };
type NewReceiptKind = null | "sale" | "deposit" | "income";

export function ReceiptsClient({
  payments, totalCount, sales, openSales, customers, methods, incomeAccounts, settings, permissions,
}: {
  payments: Payment[];
  totalCount: number;
  sales: Sale[];
  openSales: OpenSale[];
  customers: Customer[];
  methods: PaymentMethod[];
  incomeAccounts: IncomeAccount[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const [active, setActive] = useState<Payment | null>(null);
  const [newKind, setNewKind] = useState<NewReceiptKind>(null);
  const canCreate = can(permissions, "payments", "create");
  const sym = currencySymbol(settings);
  const saleMap = new Map(sales.map((s) => [s.id, s]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const methodMap = new Map(methods.map((m) => [m.id, m]));

  const columns: Column<Payment>[] = [
    { key: "payment_no", label: "Receipt #", className: "w-[140px] font-medium" },
    { key: "date", label: "Date & time", className: "w-[150px] whitespace-nowrap", render: (r) => formatDateTime(r.created_at) },
    { key: "sale", label: "Invoice", render: (r) => saleMap.get(r.sale_id || "")?.invoice_no || "-" },
    { key: "customer", label: "Customer",
      render: (r) => customerMap.get(r.customer_id || "")?.name || <span className="text-muted-foreground">Walk-in</span> },
    { key: "method", label: "Method",
      render: (r) => {
        const m = methodMap.get(r.payment_method_id || "");
        if (!m) return <span className="text-muted-foreground">-</span>;
        return <Badge variant={m.kind === "cash" ? "success" : m.kind === "mpesa" ? "warning" : "info"}>{m.name}</Badge>;
      } },
    { key: "reference", label: "Reference",
      render: (r) => r.reference ? <span className="font-mono text-xs">{r.reference}</span> : <span className="text-muted-foreground">-</span> },
    { key: "amount", label: "Amount", className: "w-[120px] text-right",
      render: (r) => <span className="font-semibold text-emerald-700">{formatMoney(r.amount, sym)}</span> },
  ];

  const filters: FilterDef[] = [
    { key: "payment_method_id", label: "Method",
      options: methods.map((m) => ({ value: m.id, label: m.name })) },
    { key: "customer_id", label: "Customer",
      options: customers.map((c) => ({ value: c.id, label: c.name })) },
  ];

  const totalIn = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div>
      <PageHeader title="Receipts" description="Every money-in: sale receipts, deposits, other income">
        {canCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4" /> New Receipt <ChevronDown className="h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setNewKind("sale")}>
                <Wallet className="h-4 w-4 mr-2 text-blue-600" />
                <div>
                  <div className="font-medium">Sale Receipt</div>
                  <div className="text-xs text-slate-500">Apply payment to a credit sale</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewKind("deposit")}>
                <PiggyBank className="h-4 w-4 mr-2 text-emerald-600" />
                <div>
                  <div className="font-medium">Customer Deposit</div>
                  <div className="text-xs text-slate-500">Held as a liability until applied</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewKind("income")}>
                <Banknote className="h-4 w-4 mr-2 text-amber-600" />
                <div>
                  <div className="font-medium">Other Income</div>
                  <div className="text-xs text-slate-500">Interest, refunds, asset sale</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wider opacity-90">Receipts shown</div>
          <div className="text-3xl font-bold mt-1">{payments.length}</div>
          <div className="text-xs opacity-80 mt-1">of {totalCount} total</div>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wider opacity-90">Money received</div>
          <div className="text-3xl font-bold mt-1">{formatMoney(totalIn, sym)}</div>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 text-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wider opacity-90">Avg receipt</div>
          <div className="text-3xl font-bold mt-1">{formatMoney(payments.length ? totalIn / payments.length : 0, sym)}</div>
        </div>
      </div>

      <DataTable<Payment>
        columns={columns}
        data={payments}
        totalCount={totalCount}
        searchPlaceholder="Search by receipt number..."
        filters={filters}
        rowActions={(row) => (
          <>
            <Button variant="ghost" size="icon" onClick={() => setActive(row)} title="View">
              <Eye className="h-4 w-4" />
            </Button>
          </>
        )}
      />

      {active && (
        <ReceiptViewer payment={active}
          sale={saleMap.get(active.sale_id || "") || null}
          customer={customerMap.get(active.customer_id || "") || null}
          method={methodMap.get(active.payment_method_id || "") || null}
          settings={settings}
          onClose={() => setActive(null)} />
      )}

      {newKind === "sale" && (
        <SaleReceiptDialog
          methods={methods} customers={customers} openSales={openSales}
          onClose={() => setNewKind(null)} />
      )}
      {newKind === "deposit" && (
        <CustomerDepositDialog
          methods={methods} customers={customers}
          onClose={() => setNewKind(null)} />
      )}
      {newKind === "income" && (
        <OtherIncomeDialog
          methods={methods} incomeAccounts={incomeAccounts}
          onClose={() => setNewKind(null)} />
      )}
    </div>
  );
}

/* SALE RECEIPT v2 - customer-first, multi-invoice FIFO allocation. */
function SaleReceiptDialog_OLD({
  methods, customers, openSales, onClose,
}: {
  methods: PaymentMethod[];
  customers: Customer[];
  openSales: OpenSale[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saleId, setSaleId] = useState("");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [reference, setReference] = useState("");
  const sale = openSales.find((s) => s.id === saleId);
  const balance = sale ? Math.max(0, Number(sale.total) - Number(sale.amount_paid || 0)) : 0;
  const [amount, setAmount] = useState("");

  function pickSale(id: string) {
    setSaleId(id);
    const s = openSales.find((x) => x.id === id);
    if (s) setAmount(Math.max(0, Number(s.total) - Number(s.amount_paid || 0)).toFixed(2));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sale) { toast.error("Select a sale"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    if (amt > balance + 0.001) { toast.error(`Cannot exceed balance ${balance.toFixed(2)}`); return; }
    start(async () => {
      const r = await recordPayment({
        direction: "in",
        source_type: "sale",
        sale_id: sale.id,
        customer_id: sale.customer_id,
        payment_method_id: methodId,
        amount: amt,
        reference: reference || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Receipt ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Sale Receipt</DialogTitle>
          <DialogDescription>Record payment received against an open credit sale.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Sale</Label>
            <Combobox value={saleId} onChange={pickSale}
              options={openSales.map((s) => {
                const cust = customers.find((c) => c.id === s.customer_id);
                const bal = Number(s.total) - Number(s.amount_paid || 0);
                return { value: s.id, label: `${s.invoice_no} - ${cust?.name || "?"}`,
                  sub: `Balance ${bal.toFixed(2)} - ${s.sale_type}` };
              })}
              placeholder="Pick an open credit sale..." />
          </div>
          {sale && (
            <div className="bg-slate-50 rounded-md p-3 text-sm grid grid-cols-3 gap-2">
              <div><div className="text-xs text-slate-500">Total</div><div className="font-semibold">{formatMoney(sale.total)}</div></div>
              <div><div className="text-xs text-slate-500">Paid</div><div className="font-semibold">{formatMoney(sale.amount_paid || 0)}</div></div>
              <div><div className="text-xs text-slate-500">Balance</div><div className="font-bold text-red-600">{formatMoney(balance)}</div></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="method">Payment Method</Label>
              <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" type="number" step="0.01" min="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="ref">Reference</Label>
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="M-Pesa code / cheque #" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Receipt"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* SALE RECEIPT v2 - customer-first with A/R aging + multi-invoice FIFO */
function SaleReceiptDialog({
  methods, customers, openSales, onClose,
}: {
  methods: PaymentMethod[];
  customers: Customer[];
  openSales: OpenSale[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [selectedSaleIds, setSelectedSaleIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"select" | "fifo">("select");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const customerSales = openSales
    .filter((s) => s.customer_id === customerId)
    .map((s) => ({ ...s, balance: Math.max(0, Number(s.total) - Number(s.amount_paid || 0)) }))
    .filter((s) => s.balance > 0.001)
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalOutstanding = customerSales.reduce((s, x) => s + x.balance, 0);
  const overdueCount = customerSales.filter((s) => isOverdue(s.due_date)).length;
  const selectedBalanceSum = customerSales
    .filter((s) => selectedSaleIds.includes(s.id))
    .reduce((sum, s) => sum + s.balance, 0);

  function pickCustomer(id: string) {
    setCustomerId(id);
    setSelectedSaleIds([]);
    setAmount("");
  }

  function toggleSale(id: string) {
    setSelectedSaleIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const subset = customerSales.filter((s) => next.includes(s.id));
      const sum = subset.reduce((acc, s) => acc + s.balance, 0);
      setAmount(sum.toFixed(2));
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { toast.error("Pick a customer"); return; }
    if (!methodId) { toast.error("Pick a payment method"); return; }
    const totalAmt = Number(amount);
    if (!totalAmt || totalAmt <= 0) { toast.error("Amount required"); return; }
    if (totalAmt > totalOutstanding + 0.001) {
      toast.error(`Cannot exceed total outstanding ${totalOutstanding.toFixed(2)}. Record a Customer Deposit for any overage.`);
      return;
    }

    const target = mode === "fifo"
      ? customerSales
      : customerSales.filter((s) => selectedSaleIds.includes(s.id));
    if (target.length === 0) {
      toast.error(mode === "fifo" ? "No invoices to allocate to" : "Select at least one invoice");
      return;
    }

    let remaining = totalAmt;
    const allocations: { sale: typeof customerSales[number]; apply: number }[] = [];
    for (const s of target) {
      if (remaining <= 0.001) break;
      const apply = Math.min(s.balance, remaining);
      if (apply > 0.001) { allocations.push({ sale: s, apply }); remaining -= apply; }
    }
    if (allocations.length === 0) { toast.error("Nothing to allocate"); return; }

    start(async () => {
      let firstReceiptNo: string | undefined;
      for (const { sale, apply } of allocations) {
        const r = await recordPayment({
          direction: "in",
          source_type: "sale",
          sale_id: sale.id,
          customer_id: sale.customer_id,
          payment_method_id: methodId,
          amount: apply,
          reference: reference || null,
          date,
          notes: memo || null,
        });
        if (!r.ok) { toast.error(r.error || `Failed on ${sale.invoice_no}`); return; }
        firstReceiptNo = firstReceiptNo || r.payment_no;
      }
      toast.success(allocations.length === 1
        ? `Receipt ${firstReceiptNo} recorded`
        : `${allocations.length} receipts recorded (total ${formatMoney(totalAmt)})`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Sale Receipt</DialogTitle>
          <DialogDescription>Pick a customer, see their open invoices, then apply the payment.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Customer *</Label>
            <Combobox value={customerId} onChange={pickCustomer}
              options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.email || c.phone || c.code }))}
              placeholder="Search customer..." />
          </div>

          {customerId && (
            <>
              <div className="rounded-lg border bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-[11px] uppercase text-emerald-700/80 font-medium">Outstanding</div>
                  <div className="text-xl font-bold text-emerald-900">{formatMoney(totalOutstanding)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-emerald-700/80 font-medium">Open invoices</div>
                  <div className="text-xl font-bold text-emerald-900">{customerSales.length}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-emerald-700/80 font-medium">Overdue</div>
                  <div className={overdueCount > 0 ? "text-xl font-bold text-red-700" : "text-xl font-bold text-emerald-900"}>
                    {overdueCount}
                  </div>
                </div>
              </div>

              {customerSales.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-3 bg-slate-50 rounded">
                  No open invoices for this customer.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={mode === "select"} onChange={() => setMode("select")} />
                      Apply to selected invoice(s)
                    </label>
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={mode === "fifo"} onChange={() => { setMode("fifo"); setAmount(totalOutstanding.toFixed(2)); }} />
                      Auto-allocate (FIFO oldest-first)
                    </label>
                  </div>

                  <div className="border rounded-md max-h-[260px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr className="text-left text-slate-500">
                          {mode === "select" && <th className="p-2 w-8"></th>}
                          <th className="p-2">Invoice</th>
                          <th className="p-2">Date</th>
                          <th className="p-2">Due</th>
                          <th className="p-2 text-right">Total</th>
                          <th className="p-2 text-right">Paid</th>
                          <th className="p-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerSales.map((s) => {
                          const overdue = isOverdue(s.due_date);
                          const days = s.due_date ? ageDays(s.due_date, today) : 0;
                          const rowSelected = selectedSaleIds.includes(s.id);
                          return (
                            <tr key={s.id} className={`border-t hover:bg-slate-50 ${rowSelected ? "bg-blue-50" : ""}`}>
                              {mode === "select" && (
                                <td className="p-2">
                                  <input type="checkbox" checked={rowSelected} onChange={() => toggleSale(s.id)} />
                                </td>
                              )}
                              <td className="p-2 font-mono font-medium">{s.invoice_no}</td>
                              <td className="p-2">{formatDate(s.date)}</td>
                              <td className="p-2">
                                {s.due_date ? (
                                  <span className={overdue ? "text-red-600 font-medium" : ""}>
                                    {formatDate(s.due_date)}
                                    {overdue && <Badge variant="danger" className="ml-1 text-[9px]">{days}d</Badge>}
                                  </span>
                                ) : <span className="text-slate-400">-</span>}
                              </td>
                              <td className="p-2 text-right">{formatMoney(s.total)}</td>
                              <td className="p-2 text-right">{formatMoney(s.amount_paid || 0)}</td>
                              <td className="p-2 text-right font-semibold">{formatMoney(s.balance)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {mode === "select" && selectedSaleIds.length > 0 && (
                    <div className="text-xs text-slate-500 text-right">
                      Selected balance: <b>{formatMoney(selectedBalanceSum)}</b>
                    </div>
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="method">Payment Method *</Label>
                  <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="amt">Amount *</Label>
                  <Input id="amt" type="number" step="0.01" min="0.01" value={amount}
                    onChange={(e) => setAmount(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="ref">Reference</Label>
                  <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)}
                    placeholder="M-Pesa code / cheque #" />
                </div>
              </div>
              <div>
                <Label htmlFor="memo">Memo (internal note)</Label>
                <Textarea id="memo" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || !customerId || customerSales.length === 0}>
              {pending ? "Saving..." : `Record Receipt${amount ? ` ${formatMoney(Number(amount) || 0)}` : ""}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Days between due date and today; positive if overdue. */
function ageDays(dueDateStr: string, today: string): number {
  const d = new Date(dueDateStr).getTime();
  const t = new Date(today).getTime();
  return Math.round((t - d) / (1000 * 60 * 60 * 24));
}
function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toISOString().slice(0, 10));
}

/* CUSTOMER DEPOSIT */
function CustomerDepositDialog({
  methods, customers, onClose,
}: {
  methods: PaymentMethod[];
  customers: Customer[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) { toast.error("Select a customer"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    start(async () => {
      const r = await recordCustomerDeposit({
        customer_id: customerId,
        amount: amt,
        payment_method_id: methodId,
        reference: reference || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Deposit ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Customer Deposit</DialogTitle>
          <DialogDescription>Posts Dr Cash / Cr Customer Advances (2200). Apply to a sale later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Customer *</Label>
            <Combobox value={customerId} onChange={setCustomerId}
              options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.email || c.phone || c.code }))}
              placeholder="Choose a customer..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="method">Payment Method</Label>
              <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" type="number" step="0.01" min="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="ref">Reference</Label>
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Deposit"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* OTHER INCOME */
function OtherIncomeDialog({
  methods, incomeAccounts, onClose,
}: {
  methods: PaymentMethod[];
  incomeAccounts: IncomeAccount[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [accountCode, setAccountCode] = useState(incomeAccounts[0]?.code || "4100");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    if (!description.trim()) { toast.error("Describe the income"); return; }
    start(async () => {
      const r = await recordOtherIncome({
        amount: amt,
        income_account_code: accountCode,
        payment_method_id: methodId,
        description: description.trim(),
        reference: reference || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Income ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Other Income</DialogTitle>
          <DialogDescription>Interest, refunds in, asset sale, commissions. Posts Dr Cash / Cr [income account].</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="acc">Income Category</Label>
              <Select id="acc" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
                {incomeAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" type="number" step="0.01" min="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="desc">Description *</Label>
            <Textarea id="desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Bank interest July - sold scrap metal - supplier refund" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="method">Received In</Label>
              <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ref">Reference</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Income"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptViewer({
  payment, sale, customer, method, settings, onClose,
}: {
  payment: Payment;
  sale: Sale | null;
  customer: Customer | null;
  method: PaymentMethod | null;
  settings: SettingsData;
  onClose: () => void;
}) {
  const sym = currencySymbol(settings);
  const company = settings.company?.name || "Receipt";
  const tax = settings.tax;
  const showLogo = settings.receipt?.showLogo !== false && settings.branding?.logoUrl;
  const showTaxBreakdown = settings.receipt?.showTaxBreakdown !== false;

  function printReceipt() {
    if (typeof window === "undefined") return;
    const win = window.open("", "_blank", "width=320,height=600");
    if (!win) return;
    const items = sale?.items || [];
    const lineRows = items.map((l) => `
      <div class="row"><span>${escapeHtml(l.name)} x${l.qty}</span><span>${sym}${(l.qty * l.price).toFixed(2)}</span></div>
    `).join("");
    const html = `<!doctype html><html><head><title>${escapeHtml(payment.payment_no)}</title>
      <style>
        body { font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; max-width: 280px; margin: 0 auto; }
        h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
        .small { font-size: 11px; color: #555; text-align: center; }
        .row { display: flex; justify-content: space-between; padding: 2px 0; }
        .total { border-top: 1px dashed #999; margin-top: 6px; padding-top: 6px; font-weight: bold; }
        .footer { text-align: center; margin-top: 12px; font-size: 11px; color: #555; }
        img.logo { display:block; margin: 0 auto 6px; max-height: 56px; }
      </style></head><body>
      ${showLogo ? `<img class="logo" src="${escapeHtml(settings.branding?.logoUrl || "")}" />` : ""}
      <h1>${escapeHtml(company)}</h1>
      ${settings.company?.address ? `<div class="small">${escapeHtml(settings.company.address)}</div>` : ""}
      ${settings.company?.phone   ? `<div class="small">Tel: ${escapeHtml(settings.company.phone)}</div>` : ""}
      ${tax?.registrationNo       ? `<div class="small">${escapeHtml(tax.name || "Tax")} #: ${escapeHtml(tax.registrationNo)}</div>` : ""}
      ${settings.receipt?.header  ? `<div class="small" style="margin-top:6px">${escapeHtml(settings.receipt.header)}</div>` : ""}
      <hr/>
      <div class="row"><span>Receipt</span><span>${escapeHtml(payment.payment_no)}</span></div>
      ${sale ? `<div class="row"><span>Invoice</span><span>${escapeHtml(sale.invoice_no)}</span></div>` : ""}
      <div class="row"><span>Date</span><span>${formatDate(payment.date)}</span></div>
      ${customer ? `<div class="row"><span>Customer</span><span>${escapeHtml(customer.name)}</span></div>` : ""}
      ${method ? `<div class="row"><span>Method</span><span>${escapeHtml(method.name)}</span></div>` : ""}
      ${payment.reference ? `<div class="row"><span>Ref</span><span>${escapeHtml(payment.reference)}</span></div>` : ""}
      <hr/>
      ${lineRows}
      ${sale && showTaxBreakdown ? `
        <div class="row"><span>Subtotal</span><span>${sym}${Number(sale.subtotal).toFixed(2)}</span></div>
        ${Number(sale.discount) > 0 ? `<div class="row"><span>Discount</span><span>-${sym}${Number(sale.discount).toFixed(2)}</span></div>` : ""}
        ${Number(sale.tax) > 0      ? `<div class="row"><span>${escapeHtml(tax?.name || "Tax")}</span><span>${sym}${Number(sale.tax).toFixed(2)}</span></div>` : ""}
      ` : ""}
      <div class="row total"><span>Paid</span><span>${sym}${Number(payment.amount).toFixed(2)}</span></div>
      ${payment.tendered_amount && payment.tendered_amount > 0 ? `<div class="row"><span>Tendered</span><span>${sym}${Number(payment.tendered_amount).toFixed(2)}</span></div>` : ""}
      ${payment.change_due && payment.change_due > 0 ? `<div class="row"><span>Change</span><span>${sym}${Number(payment.change_due).toFixed(2)}</span></div>` : ""}
      <div class="footer">${escapeHtml(settings.receipt?.footer || "Thank you for your business!")}</div>
      ${settings.receipt?.returnPolicy ? `<div class="footer">${escapeHtml(settings.receipt.returnPolicy)}</div>` : ""}
      <script>window.onload = () => { window.print(); };</script>
      </body></html>`;
    win.document.write(html);
    win.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-emerald-600" /> Receipt {payment.payment_no}
          </DialogTitle>
          <DialogDescription>
            {formatDate(payment.date)} - {customer?.name || "Walk-in customer"}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-slate-50 rounded-lg p-4 text-sm space-y-1">
          {sale && (
            <div className="flex justify-between"><span className="text-slate-500">Invoice</span>
              <span className="font-mono font-medium">{sale.invoice_no}</span></div>
          )}
          <div className="flex justify-between"><span className="text-slate-500">Method</span>
            <span className="font-medium">{method?.name || "-"}</span></div>
          {payment.reference && (
            <div className="flex justify-between"><span className="text-slate-500">Reference</span>
              <span className="font-mono font-medium">{payment.reference}</span></div>
          )}
          <div className="flex justify-between pt-2 mt-2 border-t border-slate-300">
            <span className="text-slate-700 font-medium">Amount</span>
            <span className="text-lg font-bold text-emerald-700">{formatMoney(payment.amount, sym)}</span>
          </div>
          {payment.tendered_amount && payment.tendered_amount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Tendered</span>
              <span className="font-mono">{formatMoney(payment.tendered_amount, sym)}</span>
            </div>
          )}
          {payment.change_due && payment.change_due > 0 && (
            <div className="flex justify-between bg-emerald-50 rounded px-2 py-1.5">
              <span className="text-emerald-800 font-semibold">Change</span>
              <span className="font-bold text-emerald-700">{formatMoney(payment.change_due, sym)}</span>
            </div>
          )}
        </div>

        {payment.notes && <div className="text-xs text-slate-500 mt-2">{payment.notes}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={printReceipt}><Printer className="h-4 w-4" /> Print / Re-print</Button>
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
