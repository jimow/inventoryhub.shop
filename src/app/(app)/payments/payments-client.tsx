"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpFromLine, Plus, Wallet, Receipt as ReceiptIcon,
  Banknote, Building2, ChevronDown, ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";

import type { Payment, PaymentMethod, Customer, Supplier } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils";
import {
  deletePayment, recordPayment, recordExpense, recordOwnerDrawing, recordBankTransfer,
  approvePayment, rejectPayment,
} from "./actions";

type OpenPurchase = { id: string; po_no: string; date: string; due_date: string | null; total: number; amount_paid: number; supplier_id: string | null };
type Account = { code: string; name: string; type: "asset" | "liability" | "equity" | "income" | "expense" };
type NewPaymentKind = null | "supplier" | "expense" | "other" | "transfer";

export function PaymentsClient({
  payments, totalCount, methods, customers, suppliers, openPurchases, accounts, permissions,
}: {
  payments: Payment[];
  totalCount: number;
  methods: PaymentMethod[];
  customers: Customer[];
  suppliers: Supplier[];
  openPurchases: OpenPurchase[];
  accounts: Account[];
  permissions: PermissionMatrix;
}) {
  const router = useRouter();
  useSearchParams();
  const [newKind, setNewKind] = useState<NewPaymentKind>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canCreate = can(permissions, "payments", "create");
  const canApprove = can(permissions, "payments", "approve");

  // Only posted/immediate payments count as real outflow; pending/rejected don't.
  const outflows = payments
    .filter((p) => p.approval_status !== "pending" && p.approval_status !== "rejected")
    .reduce((s, p) => s + Number(p.amount), 0);
  const pendingCount = payments.filter((p) => p.approval_status === "pending").length;

  async function doApprove(id: string) {
    setBusyId(id);
    const r = await approvePayment(id);
    setBusyId(null);
    if (!r.ok) { toast.error(r.error || "Failed"); return; }
    toast.success("Approval recorded");
    router.refresh();
  }
  async function doReject(id: string) {
    setBusyId(id);
    const r = await rejectPayment(id);
    setBusyId(null);
    if (!r.ok) { toast.error(r.error || "Failed"); return; }
    toast.success("Payment rejected");
    router.refresh();
  }

  const columns: Column<Payment>[] = [
    { key: "payment_no", label: "Payment #", className: "w-[140px] font-medium" },
    { key: "date", label: "Date & time", className: "w-[150px] whitespace-nowrap", render: (r) => formatDateTime(r.created_at) },
    { key: "party", label: "Paid To",
      render: (r) => {
        if (r.customer_id) {
          const c = customers.find((x) => x.id === r.customer_id);
          return c ? <Link href={`/customers/${c.id}`} className="text-blue-600 hover:underline">{c.name}</Link> : "—";
        }
        if (r.supplier_id) {
          const s = suppliers.find((x) => x.id === r.supplier_id);
          return s ? <Link href={`/suppliers/${s.id}`} className="text-blue-600 hover:underline">{s.name}</Link> : "—";
        }
        return <span className="text-muted-foreground">—</span>;
      } },
    { key: "method", label: "Method", className: "w-[140px]",
      render: (r) => methods.find((m) => m.id === r.payment_method_id)?.name || "—" },
    { key: "reference", label: "Reference", className: "font-mono text-xs" },
    { key: "amount", label: "Amount", className: "w-[140px] text-right font-semibold",
      render: (r) => <span className="text-amber-700">-{formatMoney(r.amount)}</span> },
    { key: "approval_status", label: "Status", className: "w-[150px]",
      render: (r) => <ApprovalBadge p={r} /> },
  ];

  const filters: FilterDef[] = [
    { key: "source_type", label: "Source", options: [
      { value: "sale", label: "Sale" }, { value: "purchase", label: "Purchase" }, { value: "other", label: "Other" },
    ]},
    { key: "payment_method_id", label: "Method",
      options: methods.map((m) => ({ value: m.id, label: m.name })) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Payments" description="Money paid out — supplier payments, expenses, salaries, transfers">
        {canCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4" /> New Payment <ChevronDown className="h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setNewKind("supplier")}>
                <Wallet className="h-4 w-4 mr-2 text-blue-600" />
                <div>
                  <div className="font-medium">Supplier Payment</div>
                  <div className="text-xs text-slate-500">Settle a credit purchase</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewKind("expense")}>
                <ReceiptIcon className="h-4 w-4 mr-2 text-amber-600" />
                <div>
                  <div className="font-medium">Operating Expense</div>
                  <div className="text-xs text-slate-500">Rent, utilities, salaries, etc.</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewKind("other")}>
                <Building2 className="h-4 w-4 mr-2 text-slate-600" />
                <div>
                  <div className="font-medium">Other Payment</div>
                  <div className="text-xs text-slate-500">Owner drawing, tax remit</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewKind("transfer")}>
                <Banknote className="h-4 w-4 mr-2 text-cyan-600" />
                <div>
                  <div className="font-medium">Bank Transfer</div>
                  <div className="text-xs text-slate-500">Move money between cash / bank accounts</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>

      <div className={`grid grid-cols-1 ${pendingCount > 0 ? "sm:grid-cols-2" : ""} gap-3`}>
        <Card className="p-4 bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-amber-700/80">
            <ArrowUpFromLine className="h-3.5 w-3.5" /> Total Paid Out
          </div>
          <div className="text-2xl font-bold text-amber-900 mt-1">{formatMoney(outflows)}</div>
        </Card>
        {pendingCount > 0 && (
          <Card className="p-4 bg-gradient-to-br from-violet-50 to-violet-100/50 border-violet-200">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-violet-700/80">
              <ShieldAlert className="h-3.5 w-3.5" /> Awaiting Approval
            </div>
            <div className="text-2xl font-bold text-violet-900 mt-1">{pendingCount}</div>
          </Card>
        )}
      </div>

      <DataTable<Payment>
        columns={columns}
        data={payments}
        totalCount={totalCount}
        searchPlaceholder="Search by payment # or reference..."
        filters={filters}
        rowActions={(row) => (
          <>
            {canApprove && row.approval_status === "pending" && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-emerald-700 border-emerald-200"
                  disabled={busyId === row.id} onClick={() => doApprove(row.id)}>
                  Approve {row.approvals?.length ? `(${row.approvals.length}/${row.required_levels})` : ""}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-red-700 border-red-200"
                  disabled={busyId === row.id} onClick={() => doReject(row.id)}>
                  Reject
                </Button>
              </>
            )}
            {can(permissions, "payments", "delete") && (
              <DeleteButton action={() => deletePayment(row.id)} message="The journal entry will also be reversed." />
            )}
          </>
        )}
      />

      {newKind === "supplier" && (
        <SupplierPaymentDialog
          methods={methods}
          suppliers={suppliers}
          openPurchases={openPurchases}
          onClose={() => setNewKind(null)} />
      )}
      {newKind === "expense" && (
        <ExpenseDialog
          methods={methods}
          suppliers={suppliers}
          expenseAccounts={accounts.filter((a) => a.type === "expense")}
          onClose={() => setNewKind(null)} />
      )}
      {newKind === "other" && (
        <OtherPaymentDialog
          methods={methods}
          debitAccounts={accounts.filter((a) => a.type !== "asset" && a.type !== "income")}
          onClose={() => setNewKind(null)} />
      )}
      {newKind === "transfer" && (
        <BankTransferDialog methods={methods} onClose={() => setNewKind(null)} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SUPPLIER PAYMENT v2 - supplier-first with A/P aging + multi-PO FIFO        */
/* -------------------------------------------------------------------------- */
function SupplierPaymentDialog({
  methods, suppliers, openPurchases, onClose,
}: {
  methods: PaymentMethod[];
  suppliers: Supplier[];
  openPurchases: OpenPurchase[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [supplierId, setSupplierId] = useState("");
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"select" | "fifo">("select");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const supplierPOs = openPurchases
    .filter((p) => p.supplier_id === supplierId)
    .map((p) => ({ ...p, balance: Math.max(0, Number(p.total) - Number(p.amount_paid || 0)) }))
    .filter((p) => p.balance > 0.001)
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalOutstanding = supplierPOs.reduce((s, x) => s + x.balance, 0);
  const overdueCount = supplierPOs.filter((p) => isPaymentOverdue(p.due_date)).length;
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const openingBal = Number(selectedSupplier?.opening_balance || 0);
  const selectedBalanceSum = supplierPOs
    .filter((p) => selectedPoIds.includes(p.id))
    .reduce((sum, p) => sum + p.balance, 0);

  function pickSupplier(id: string) {
    setSupplierId(id);
    setSelectedPoIds([]);
    setAmount("");
  }

  function togglePo(id: string) {
    setSelectedPoIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const subset = supplierPOs.filter((p) => next.includes(p.id));
      const sum = subset.reduce((acc, p) => acc + p.balance, 0);
      setAmount(sum.toFixed(2));
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { toast.error("Pick a supplier"); return; }
    if (!methodId) { toast.error("Pick a payment method"); return; }
    const totalAmt = Number(amount);
    if (!totalAmt || totalAmt <= 0) { toast.error("Amount required"); return; }
    if (totalAmt > totalOutstanding + 0.001) {
      toast.error(`Cannot exceed total outstanding ${totalOutstanding.toFixed(2)}.`);
      return;
    }

    const target = mode === "fifo"
      ? supplierPOs
      : supplierPOs.filter((p) => selectedPoIds.includes(p.id));
    if (target.length === 0) {
      toast.error(mode === "fifo" ? "No POs to allocate to" : "Select at least one PO");
      return;
    }

    let remaining = totalAmt;
    const allocations: { po: typeof supplierPOs[number]; apply: number }[] = [];
    for (const po of target) {
      if (remaining <= 0.001) break;
      const apply = Math.min(po.balance, remaining);
      if (apply > 0.001) { allocations.push({ po, apply }); remaining -= apply; }
    }

    const feeNum = Math.max(0, Number(fee) || 0);
    start(async () => {
      let firstNo: string | undefined;
      for (let i = 0; i < allocations.length; i++) {
        const { po, apply } = allocations[i];
        const r = await recordPayment({
          direction: "out",
          source_type: "purchase",
          purchase_id: po.id,
          supplier_id: po.supplier_id,
          payment_method_id: methodId,
          amount: apply,
          fee: i === 0 ? feeNum : 0, // charge applies once to the whole payment
          reference: reference || null,
          date,
          notes: memo || null,
        });
        if (!r.ok) { toast.error(r.error || `Failed on ${po.po_no}`); return; }
        firstNo = firstNo || r.payment_no;
      }
      toast.success(allocations.length === 1
        ? `Payment ${firstNo} recorded`
        : `${allocations.length} payments recorded (total ${formatMoney(totalAmt)})`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Supplier Payment</DialogTitle>
          <DialogDescription>Pick a supplier, see their open purchase orders, then settle the balance.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Supplier *</Label>
            <Combobox value={supplierId} onChange={pickSupplier}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Search supplier..." />
          </div>

          {supplierId && (
            <>
              {selectedSupplier && (
                <div className="flex items-center justify-between text-xs">
                  <Link href={`/suppliers/${selectedSupplier.id}`} className="text-blue-600 hover:underline font-medium">
                    {selectedSupplier.name} — view details →
                  </Link>
                </div>
              )}
              <div className={`rounded-lg border bg-gradient-to-br from-amber-50 to-amber-100/40 p-3 grid ${openingBal !== 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"} gap-2 text-sm`}>
                {openingBal !== 0 && (
                  <div>
                    <div className="text-[11px] uppercase text-amber-700/80 font-medium">Opening balance</div>
                    <div className="text-xl font-bold text-amber-900">{formatMoney(openingBal)}</div>
                  </div>
                )}
                <div>
                  <div className="text-[11px] uppercase text-amber-700/80 font-medium">PO Outstanding</div>
                  <div className="text-xl font-bold text-amber-900">{formatMoney(totalOutstanding)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-amber-700/80 font-medium">Open POs</div>
                  <div className="text-xl font-bold text-amber-900">{supplierPOs.length}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-amber-700/80 font-medium">Overdue</div>
                  <div className={overdueCount > 0 ? "text-xl font-bold text-red-700" : "text-xl font-bold text-amber-900"}>
                    {overdueCount}
                  </div>
                </div>
              </div>
              {openingBal !== 0 && (
                <p className="text-[11px] text-slate-500 -mt-1">
                  Opening balance of {formatMoney(openingBal)} is owed from before the system started. Total owed:{" "}
                  <b className="text-slate-700">{formatMoney(openingBal + totalOutstanding)}</b>. PO payments below settle the outstanding orders; the opening balance is carried in A/P.
                </p>
              )}

              {supplierPOs.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-3 bg-slate-50 rounded">
                  No open purchase orders for this supplier.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={mode === "select"} onChange={() => setMode("select")} />
                      Apply to selected PO(s)
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
                          <th className="p-2">PO #</th>
                          <th className="p-2">Date</th>
                          <th className="p-2">Due</th>
                          <th className="p-2 text-right">Total</th>
                          <th className="p-2 text-right">Paid</th>
                          <th className="p-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierPOs.map((p) => {
                          const overdue = isPaymentOverdue(p.due_date);
                          const days = p.due_date ? agePaymentDays(p.due_date, today) : 0;
                          const sel = selectedPoIds.includes(p.id);
                          return (
                            <tr key={p.id} className={`border-t hover:bg-slate-50 ${sel ? "bg-blue-50" : ""}`}>
                              {mode === "select" && (
                                <td className="p-2">
                                  <input type="checkbox" checked={sel} onChange={() => togglePo(p.id)} />
                                </td>
                              )}
                              <td className="p-2 font-mono font-medium">{p.po_no}</td>
                              <td className="p-2">{formatDate(p.date)}</td>
                              <td className="p-2">
                                {p.due_date ? (
                                  <span className={overdue ? "text-red-600 font-medium" : ""}>
                                    {formatDate(p.due_date)}
                                    {overdue && <Badge variant="danger" className="ml-1 text-[9px]">{days}d</Badge>}
                                  </span>
                                ) : <span className="text-slate-400">-</span>}
                              </td>
                              <td className="p-2 text-right">{formatMoney(p.total)}</td>
                              <td className="p-2 text-right">{formatMoney(p.amount_paid || 0)}</td>
                              <td className="p-2 text-right font-semibold">{formatMoney(p.balance)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {mode === "select" && selectedPoIds.length > 0 && (
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
                    placeholder="cheque #, txn id..." />
                </div>
                <div>
                  <Label htmlFor="fee">Bank / txn charge</Label>
                  <Input id="fee" type="number" step="0.01" min="0" value={fee}
                    onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
                  <p className="text-[11px] text-muted-foreground mt-0.5">Extra cash out, expensed to Bank Charges.</p>
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
            <Button type="submit" disabled={pending || !supplierId || supplierPOs.length === 0}>
              {pending ? "Saving..." : `Record Payment${amount ? ` ${formatMoney(Number(amount) || 0)}` : ""}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function agePaymentDays(dueDateStr: string, today: string): number {
  const d = new Date(dueDateStr).getTime();
  const t = new Date(today).getTime();
  return Math.round((t - d) / (1000 * 60 * 60 * 24));
}
function isPaymentOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toISOString().slice(0, 10));
}

function _OldSupplierPaymentDialog_unused({
  methods, suppliers, openPurchases, onClose,
}: {
  methods: PaymentMethod[];
  suppliers: Supplier[];
  openPurchases: OpenPurchase[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [purchaseId, setPurchaseId] = useState("");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [reference, setReference] = useState("");
  const po = openPurchases.find((p) => p.id === purchaseId);
  const balance = po ? Math.max(0, Number(po.total) - Number(po.amount_paid || 0)) : 0;
  const [amount, setAmount] = useState("0.00");

  function pickPO(id: string) {
    setPurchaseId(id);
    const p = openPurchases.find((x) => x.id === id);
    if (p) setAmount(Math.max(0, Number(p.total) - Number(p.amount_paid || 0)).toFixed(2));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!po) { toast.error("Select a purchase order"); return; }
    if (!methodId) { toast.error("Select payment method"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    if (amt > balance + 0.001) { toast.error(`Cannot exceed balance ${balance.toFixed(2)}`); return; }
    start(async () => {
      const r = await recordPayment({
        direction: "out",
        source_type: "purchase",
        purchase_id: po.id,
        supplier_id: po.supplier_id,
        payment_method_id: methodId,
        amount: amt,
        reference: reference || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Payment ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Supplier Payment</DialogTitle>
          <DialogDescription>Settle a purchase received on credit. Posts Dr AP / Cr Cash.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Purchase Order</Label>
            <Combobox value={purchaseId} onChange={pickPO}
              options={openPurchases.map((p) => {
                const sup = suppliers.find((s) => s.id === p.supplier_id);
                const bal = Number(p.total) - Number(p.amount_paid || 0);
                return {
                  value: p.id,
                  label: `${p.po_no} - ${sup?.name || "?"}`,
                  sub: `Balance ${bal.toFixed(2)}`,
                };
              })}
              placeholder="Pick a credit purchase..." />
          </div>
          {po && (
            <div className="bg-slate-50 rounded-md p-3 text-sm grid grid-cols-3 gap-2">
              <div><div className="text-xs text-slate-500">Total</div><div className="font-semibold">{formatMoney(po.total)}</div></div>
              <div><div className="text-xs text-slate-500">Paid</div><div className="font-semibold">{formatMoney(po.amount_paid || 0)}</div></div>
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
            <Label htmlFor="ref">Reference (cheque #, txn id...)</Label>
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* EXPENSE - operating cost (rent, utilities, etc)                            */
/* -------------------------------------------------------------------------- */
function ExpenseDialog({
  methods, suppliers, expenseAccounts, onClose,
}: {
  methods: PaymentMethod[];
  suppliers: Supplier[];
  expenseAccounts: Account[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [accountCode, setAccountCode] = useState(expenseAccounts[0]?.code || "5500");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [description, setDescription] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [reference, setReference] = useState("");
  const [fee, setFee] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    if (!description.trim()) { toast.error("Describe the expense"); return; }
    start(async () => {
      const r = await recordExpense({
        amount: amt,
        expense_account_code: accountCode,
        payment_method_id: methodId,
        description: description.trim(),
        supplier_id: supplierId || null,
        fee: Math.max(0, Number(fee) || 0),
        reference: reference || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Expense ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Operating Expense</DialogTitle>
          <DialogDescription>Rent, salaries, utilities, etc. Posts Dr Expense / Cr Cash.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="acc">Expense Category</Label>
              <Select id="acc" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
                {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
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
              placeholder="e.g. May rent · Kenya Power July bill · Q3 internet" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="method">Paid From</Label>
              <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="sup">Vendor (optional)</Label>
              <Combobox value={supplierId} onChange={setSupplierId}
                options={[{ value: "", label: "(no supplier)" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                placeholder="Vendor" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ref">Reference</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt no. / txn id" />
            </div>
            <div>
              <Label htmlFor="fee">Bank / txn charge</Label>
              <Input id="fee" type="number" step="0.01" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Expense"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* OTHER PAYMENT - owner drawing, tax remittance, transfer                    */
/* -------------------------------------------------------------------------- */
function OtherPaymentDialog({
  methods, debitAccounts, onClose,
}: {
  methods: PaymentMethod[];
  debitAccounts: Account[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [accountCode, setAccountCode] = useState("3100");
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [fee, setFee] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    start(async () => {
      const r = await recordOwnerDrawing({
        amount: amt,
        payment_method_id: methodId,
        debit_account_code: accountCode,
        description: description.trim() || undefined,
        fee: Math.max(0, Number(fee) || 0),
        reference: reference || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Payment ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Other Payment</DialogTitle>
          <DialogDescription>Owner drawing, tax remittance, transfer out. Posts Dr [chosen] / Cr Cash.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="acc">Debit Account</Label>
              <Select id="acc" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
                {debitAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="amt">Amount</Label>
              <Input id="amt" type="number" step="0.01" min="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. July VAT remittance" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="method">Paid From</Label>
              <Select id="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ref">Reference</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fee">Bank / txn charge</Label>
              <Input id="fee" type="number" step="0.01" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* BANK TRANSFER - move money between cash / bank assets                      */
/* -------------------------------------------------------------------------- */
function BankTransferDialog({ methods, onClose }: { methods: PaymentMethod[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fromId, setFromId] = useState(methods[0]?.id || "");
  const [toId, setToId] = useState(methods[1]?.id || "");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId || !toId) { toast.error("Pick both source and destination"); return; }
    if (fromId === toId) { toast.error("Source and destination must differ"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount required"); return; }
    start(async () => {
      const r = await recordBankTransfer({
        from_payment_method_id: fromId,
        to_payment_method_id: toId,
        amount: amt,
        reference: reference || null,
        date,
        notes: notes || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(`Transfer ${r.payment_no} recorded`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bank Transfer</DialogTitle>
          <DialogDescription>Move money between cash, bank, or M-Pesa accounts. Posts Dr destination / Cr source.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="from">From *</Label>
              <Select id="from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="to">To *</Label>
              <Select id="to" value={toId} onChange={(e) => setToId(e.target.value)}>
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
          </div>
          <div>
            <Label htmlFor="ref">Reference</Label>
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="bank slip / wire id" />
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. transferred cash drawer to M-Pesa float" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record Transfer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalBadge({ p }: { p: Payment }) {
  const st = p.approval_status;
  if (!st || st === "not_required") return <Badge variant="success">Posted</Badge>;
  if (st === "approved") return <Badge variant="success">Approved</Badge>;
  if (st === "rejected") return <Badge variant="danger">Rejected</Badge>;
  // pending
  const got = p.approvals?.length || 0;
  const need = p.required_levels || 1;
  return (
    <Badge variant="warning" title={(p.approvals || []).map((a) => a.name).join(", ")}>
      Pending {got}/{need}
    </Badge>
  );
}

// Silences unused import warnings since the Banknote/etc lucide icons aren't used yet
void Banknote;
