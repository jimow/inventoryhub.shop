"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Landmark, HandCoins, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";

import type { Loan, LoanPayment, PaymentMethod, SettingsData, LoanDirection } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import { createLoan, recordLoanPayment, cancelLoan, cancelLoanPayment } from "./actions";

export function LoansClient({
  loans, payments, methods, balanceByMethod, settings, permissions,
}: {
  loans: Loan[];
  payments: LoanPayment[];
  methods: PaymentMethod[];
  balanceByMethod: Record<string, number>;
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sym = currencySymbol(settings);
  const [newLoan, setNewLoan] = useState<LoanDirection | null>(null);
  const [payFor, setPayFor] = useState<Loan | null>(null);
  const canCreate = can(permissions, "loans", "create");
  const canEdit = can(permissions, "loans", "edit");

  // Outstanding principal per loan = principal − Σ principal_portion (posted).
  const paidPrincipal = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      if (p.status !== "posted") continue;
      m.set(p.loan_id, (m.get(p.loan_id) || 0) + Number(p.principal_portion || 0));
    }
    return m;
  }, [payments]);
  const loanById = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans]);

  const owed = loans.filter((l) => l.direction === "payable" && l.status !== "cancelled")
    .reduce((s, l) => s + Math.max(0, Number(l.principal) - (paidPrincipal.get(l.id) || 0)), 0);
  const due = loans.filter((l) => l.direction === "receivable" && l.status !== "cancelled")
    .reduce((s, l) => s + Math.max(0, Number(l.principal) - (paidPrincipal.get(l.id) || 0)), 0);

  return (
    <div>
      <PageHeader title="Loans" description="Money borrowed from others and lent to others · posts double-entry">
        {canCreate && (
          <>
            <Button size="sm" onClick={() => setNewLoan("payable")}><ArrowDownToLine className="h-4 w-4" /> Borrow</Button>
            <Button size="sm" variant="outline" onClick={() => setNewLoan("receivable")}><ArrowUpFromLine className="h-4 w-4" /> Lend</Button>
          </>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center text-white"><Landmark className="h-5 w-5" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">We owe (loans payable)</div>
            <div className="text-lg font-bold text-amber-700">{formatMoney(owed, sym)}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white"><HandCoins className="h-5 w-5" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Owed to us (loans receivable)</div>
            <div className="text-lg font-bold text-emerald-700">{formatMoney(due, sym)}</div></div>
        </CardContent></Card>
      </div>

      <Card className="mb-6">
        <div className="px-4 py-3 border-b font-semibold text-slate-900">Loans</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Ref</TableHead><TableHead>Type</TableHead><TableHead>Party</TableHead>
            <TableHead className="text-right">Principal</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loans.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground p-8">No loans yet.</TableCell></TableRow>
            ) : loans.map((l) => {
              const out = Math.max(0, Number(l.principal) - (paidPrincipal.get(l.id) || 0));
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.loan_no}</TableCell>
                  <TableCell>{l.direction === "payable"
                    ? <Badge variant="warning">Borrowed</Badge>
                    : <Badge variant="success">Lent</Badge>}</TableCell>
                  <TableCell>{l.party_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.principal, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatMoney(out, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(l.interest_rate).toFixed(2)}%</TableCell>
                  <TableCell><Badge variant={l.status === "active" ? "info" : l.status === "settled" ? "success" : "danger"}>{l.status}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canCreate && l.status === "active" && (
                      <Button variant="ghost" size="sm" onClick={() => setPayFor(l)}>
                        {l.direction === "payable" ? "Repay" : "Receive"}
                      </Button>
                    )}
                    {canEdit && l.status !== "cancelled" && <CancelBtn label="Cancel loan" onConfirm={() => cancelLoan(l.id)} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b font-semibold text-slate-900">Repayments &amp; receipts</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Ref</TableHead><TableHead>Loan</TableHead>
            <TableHead className="text-right">Principal</TableHead><TableHead className="text-right">Interest</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground p-8">No repayments yet.</TableCell></TableRow>
            ) : payments.map((p) => {
              const loan = loanById.get(p.loan_id);
              return (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-sm">{formatDate(p.date)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.payment_no}</TableCell>
                  <TableCell className="text-sm">{loan ? `${loan.loan_no} · ${loan.party_name}` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.principal_portion, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.interest_portion, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatMoney(p.amount, sym)}</TableCell>
                  <TableCell><Badge variant={p.status === "posted" ? "info" : "danger"}>{p.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {canEdit && p.status === "posted" && <CancelBtn label="Cancel" onConfirm={() => cancelLoanPayment(p.id)} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {newLoan && <LoanDialog direction={newLoan} methods={methods} balanceByMethod={balanceByMethod} sym={sym} onClose={() => setNewLoan(null)} />}
      {payFor && (
        <PaymentDialog loan={payFor} methods={methods} balanceByMethod={balanceByMethod} sym={sym}
          outstanding={Math.max(0, Number(payFor.principal) - (paidPrincipal.get(payFor.id) || 0))}
          onClose={() => setPayFor(null)} />
      )}
    </div>
  );
}

function CancelBtn({ label, onConfirm }: { label: string; onConfirm: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="text-amber-600" disabled={pending}
      onClick={() => { if (!confirm("Cancel? Reversing journals will be posted.")) return; start(async () => {
        const r = await onConfirm(); if (!r.ok) { toast.error(r.error || "Failed"); return; } toast.success("Cancelled & reversed"); router.refresh();
      }); }}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} {label}
    </Button>
  );
}

function LoanDialog({ direction, methods, balanceByMethod, sym, onClose }: {
  direction: LoanDirection; methods: PaymentMethod[]; balanceByMethod: Record<string, number>; sym: string; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [principal, setPrincipal] = useState<number>(0);
  const borrow = direction === "payable";
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (principal <= 0) { toast.error("Enter the principal"); return; }
    const fd = new FormData(e.currentTarget);
    fd.set("direction", direction);
    start(async () => {
      const r = await createLoan(fd);
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(borrow ? "Borrowing recorded" : "Loan given recorded");
      onClose(); router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{borrow ? "Borrow money" : "Lend money"}</DialogTitle>
          <DialogDescription>
            {borrow ? "Posts Dr Cash/Bank · Cr Loans Payable." : "Posts Dr Loans Receivable · Cr Cash/Bank (can't exceed available funds)."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label htmlFor="party_name">{borrow ? "Lender" : "Borrower"} *</Label>
            <Input id="party_name" name="party_name" required /></div>
          <div><Label htmlFor="principal">Principal *</Label>
            <Input id="principal" name="principal" type="number" step="0.01" min="0" value={principal} onChange={(e) => setPrincipal(Number(e.target.value) || 0)} required /></div>
          <div><Label htmlFor="interest_rate">Interest rate % (annual)</Label>
            <Input id="interest_rate" name="interest_rate" type="number" step="0.01" min="0" defaultValue={0} /></div>
          <div><Label htmlFor="start_date">Start date</Label>
            <Input id="start_date" name="start_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div><Label htmlFor="due_date">Due date</Label>
            <Input id="due_date" name="due_date" type="date" /></div>
          <div className="col-span-2"><Label>{borrow ? "Deposit borrowed funds into *" : "Pay the loaned-out money from *"}</Label>
            <Select name="payment_method_id" required defaultValue="">
              <option value="" disabled>— Select cash/bank account —</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}{balanceByMethod[m.id] != null ? ` · ${formatMoney(balanceByMethod[m.id], sym)}` : ""}</option>)}
            </Select>
            <p className="text-xs text-slate-500 mt-1">{borrow ? "The money is deposited here and is immediately spendable." : "Funds are paid out of this account."}</p></div>
          <div className="col-span-2"><Label htmlFor="notes">Notes</Label><Input id="notes" name="notes" placeholder="Optional" /></div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || principal <= 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {borrow ? "Borrow" : "Lend"} {formatMoney(principal, sym)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ loan, methods, balanceByMethod, sym, outstanding, onClose }: {
  loan: Loan; methods: PaymentMethod[]; balanceByMethod: Record<string, number>; sym: string; outstanding: number; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [principal, setPrincipal] = useState<number>(0);
  const [interest, setInterest] = useState<number>(0);
  const total = Math.round((principal + interest) * 100) / 100;
  const repay = loan.direction === "payable";
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (total <= 0) { toast.error("Enter an amount"); return; }
    if (principal > outstanding + 0.01) { toast.error("Principal exceeds the outstanding balance"); return; }
    const fd = new FormData(e.currentTarget);
    fd.set("loan_id", loan.id);
    start(async () => {
      const r = await recordLoanPayment(fd);
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(repay ? "Repayment recorded" : "Receipt recorded");
      onClose(); router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{repay ? "Repay loan" : "Receive repayment"} — {loan.party_name}</DialogTitle>
          <DialogDescription>
            Outstanding principal: {formatMoney(outstanding, sym)}.{" "}
            {repay ? "Posts Dr Loans Payable + Interest Expense · Cr Cash." : "Posts Dr Cash · Cr Loans Receivable + Interest Income."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="principal_portion">Principal</Label>
            <Input id="principal_portion" name="principal_portion" type="number" step="0.01" min="0" value={principal} onChange={(e) => setPrincipal(Number(e.target.value) || 0)} /></div>
          <div><Label htmlFor="interest_portion">Interest</Label>
            <Input id="interest_portion" name="interest_portion" type="number" step="0.01" min="0" value={interest} onChange={(e) => setInterest(Number(e.target.value) || 0)} /></div>
          <div><Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div><Label>{repay ? "Paid from *" : "Received into *"}</Label>
            <Select name="payment_method_id" required defaultValue="">
              <option value="" disabled>— Select cash/bank account —</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}{balanceByMethod[m.id] != null ? ` · ${formatMoney(balanceByMethod[m.id], sym)}` : ""}</option>)}
            </Select></div>
          <div className="col-span-2"><Label htmlFor="notes">Notes</Label><Input id="notes" name="notes" placeholder="Optional" /></div>
          <DialogFooter className="col-span-2 sm:justify-between">
            <span className="text-sm text-slate-600">Total: <b className="tabular-nums">{formatMoney(total, sym)}</b></span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending || total <= 0}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Record</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
