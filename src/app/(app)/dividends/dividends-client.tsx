"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X, Coins } from "lucide-react";
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

import type {
  Shareholder, DividendDeclaration, DividendLine, DividendPayout, PaymentMethod, SettingsData,
} from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import { declareDividend, payoutDividend, cancelDividend } from "./actions";

export function DividendsClient({
  shareholders, declarations, lines, payouts, methods, settings, permissions,
}: {
  shareholders: Shareholder[];
  declarations: DividendDeclaration[];
  lines: DividendLine[];
  payouts: DividendPayout[];
  methods: PaymentMethod[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sym = currencySymbol(settings);
  const [declOpen, setDeclOpen] = useState(false);
  const [payDecl, setPayDecl] = useState<DividendDeclaration | null>(null);
  const canCreate = can(permissions, "equity", "create");
  const canEdit = can(permissions, "equity", "edit");

  const shById = useMemo(() => new Map(shareholders.map((s) => [s.id, s])), [shareholders]);

  // Paid per (declaration, shareholder).
  const paidByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payouts) {
      if (p.status !== "posted") continue;
      const k = `${p.declaration_id}:${p.shareholder_id}`;
      m.set(k, (m.get(k) || 0) + Number(p.amount));
    }
    return m;
  }, [payouts]);

  const linesByDecl = useMemo(() => {
    const m = new Map<string, DividendLine[]>();
    for (const l of lines) { const a = m.get(l.declaration_id) || []; a.push(l); m.set(l.declaration_id, a); }
    return m;
  }, [lines]);

  const totalDeclared = declarations.filter((d) => d.status === "active").reduce((s, d) => s + Number(d.total_amount), 0);
  const totalPaid = payouts.filter((p) => p.status === "posted").reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = Math.max(0, Math.round((totalDeclared - totalPaid) * 100) / 100);

  return (
    <div>
      <PageHeader title="Dividends" description="Declare dividends split by ownership % · posts double-entry">
        {canCreate && (
          <Button size="sm" onClick={() => setDeclOpen(true)} disabled={shareholders.filter((s) => s.status === "active" && Number(s.ownership_pct) > 0).length === 0}>
            <Plus className="h-4 w-4" /> Declare dividend
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <StatCard label="Declared (active)" value={formatMoney(totalDeclared, sym)} />
        <StatCard label="Paid out" value={formatMoney(totalPaid, sym)} />
        <StatCard label="Payable outstanding" value={formatMoney(outstanding, sym)} amber={outstanding > 0} />
      </div>

      <Card>
        <div className="px-4 py-3 border-b font-semibold text-slate-900">Declarations</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Ref</TableHead><TableHead>Period</TableHead>
            <TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {declarations.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground p-8">No dividends declared yet.</TableCell></TableRow>
            ) : declarations.map((d) => {
              const dPaid = payouts.filter((p) => p.declaration_id === d.id && p.status === "posted").reduce((s, p) => s + Number(p.amount), 0);
              return (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap text-sm">{formatDate(d.date)}</TableCell>
                  <TableCell className="font-mono text-xs">{d.declaration_no}</TableCell>
                  <TableCell className="text-sm">{d.period_label || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(d.rate).toFixed(2)}%</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatMoney(d.total_amount, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(dPaid, sym)}</TableCell>
                  <TableCell><Badge variant={d.status === "active" ? "info" : "danger"}>{d.status}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canCreate && d.status === "active" && <Button variant="ghost" size="sm" onClick={() => setPayDecl(d)}>Pay shareholders</Button>}
                    {canEdit && d.status === "active" && <CancelBtn onConfirm={() => cancelDividend(d.id)} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {declOpen && (
        <DeclareDialog
          settings={settings} sym={sym}
          shareholders={shareholders.filter((s) => s.status === "active" && Number(s.ownership_pct) > 0)}
          onClose={() => setDeclOpen(false)} />
      )}
      {payDecl && (
        <PayDialog
          declaration={payDecl} methods={methods} sym={sym}
          lines={linesByDecl.get(payDecl.id) || []} shById={shById} paidByKey={paidByKey}
          onClose={() => setPayDecl(null)} />
      )}
    </div>
  );
}

function StatCard({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-violet-500 flex items-center justify-center text-white"><Coins className="h-5 w-5" /></div>
      <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-lg font-bold ${amber ? "text-amber-700" : "text-slate-900"}`}>{value}</div></div>
    </CardContent></Card>
  );
}

function CancelBtn({ onConfirm }: { onConfirm: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="text-amber-600" disabled={pending}
      onClick={() => { if (!confirm("Cancel this dividend? Reversing journals will be posted.")) return; start(async () => {
        const r = await onConfirm(); if (!r.ok) { toast.error(r.error || "Failed"); return; } toast.success("Cancelled & reversed"); router.refresh();
      }); }}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel
    </Button>
  );
}

function DeclareDialog({ settings, sym, shareholders, onClose }: {
  settings: SettingsData; sym: string; shareholders: Shareholder[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rate, setRate] = useState<number>(Number(settings.dividend?.rate ?? 0));
  const [base, setBase] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const computed = Math.round((base * rate) / 100 * 100) / 100;
  const effectiveTotal = total > 0 ? total : computed;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (effectiveTotal <= 0) { toast.error("Enter a base + rate, or a total amount"); return; }
    const fd = new FormData(e.currentTarget);
    fd.set("total_amount", String(effectiveTotal));
    start(async () => {
      const r = await declareDividend(fd);
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success("Dividend declared"); onClose(); router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Declare dividend</DialogTitle>
          <DialogDescription>
            Splits the total across {shareholders.length} shareholder(s) by ownership %. Posts Dr Retained Earnings · Cr Dividends Payable.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="period_label">Period</Label>
            <Input id="period_label" name="period_label" placeholder={`e.g. FY${new Date().getFullYear()} (${settings.dividend?.frequency || "yearly"})`} /></div>
          <div><Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div><Label htmlFor="base_amount">Base (profit/equity)</Label>
            <Input id="base_amount" name="base_amount" type="number" step="0.01" min="0" value={base} onChange={(e) => setBase(Number(e.target.value) || 0)} /></div>
          <div><Label htmlFor="rate">Rate %</Label>
            <Input id="rate" name="rate" type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} /></div>
          <div className="col-span-2">
            <Label htmlFor="total">Total dividend {base > 0 && rate > 0 ? `(base × rate = ${formatMoney(computed, sym)})` : ""}</Label>
            <Input id="total" type="number" step="0.01" min="0" value={total || computed || 0}
              onChange={(e) => setTotal(Number(e.target.value) || 0)} />
            <p className="text-xs text-slate-500 mt-1">Auto-filled from base × rate; override to set a total directly.</p>
          </div>
          <div className="col-span-2"><Label htmlFor="notes">Notes</Label><Input id="notes" name="notes" placeholder="Optional" /></div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || effectiveTotal <= 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Declare {formatMoney(effectiveTotal, sym)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ declaration, methods, sym, lines, shById, paidByKey, onClose }: {
  declaration: DividendDeclaration; methods: PaymentMethod[]; sym: string;
  lines: DividendLine[]; shById: Map<string, Shareholder>; paidByKey: Map<string, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shId, setShId] = useState<string>("");
  const [amount, setAmount] = useState<number>(0);

  const rows = lines.map((l) => {
    const paid = paidByKey.get(`${declaration.id}:${l.shareholder_id}`) || 0;
    return { line: l, paid, outstanding: Math.max(0, Math.round((Number(l.amount) - paid) * 100) / 100) };
  });
  const payable = rows.filter((r) => r.outstanding > 0.01);

  function pick(id: string) {
    setShId(id);
    const r = rows.find((x) => x.line.shareholder_id === id);
    setAmount(r?.outstanding || 0);
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shId) { toast.error("Pick a shareholder"); return; }
    if (amount <= 0) { toast.error("Enter an amount"); return; }
    const fd = new FormData(e.currentTarget);
    fd.set("declaration_id", declaration.id);
    fd.set("shareholder_id", shId);
    start(async () => {
      const r = await payoutDividend(fd);
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success("Dividend paid"); onClose(); router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pay dividend — {declaration.declaration_no}</DialogTitle>
          <DialogDescription>Posts Dr Dividends Payable · Cr Cash/Bank (can&apos;t exceed available funds).</DialogDescription>
        </DialogHeader>
        <div className="border rounded-md max-h-52 overflow-y-auto mb-3">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Shareholder</TableHead><TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.line.id} className={shId === r.line.shareholder_id ? "bg-accent/40" : ""}>
                  <TableCell>{shById.get(r.line.shareholder_id)?.name || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.line.amount, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.paid, sym)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatMoney(r.outstanding, sym)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Shareholder *</Label>
            <Select value={shId} onChange={(e) => pick(e.target.value)} required>
              <option value="">Select…</option>
              {payable.map((r) => <option key={r.line.shareholder_id} value={r.line.shareholder_id}>
                {shById.get(r.line.shareholder_id)?.name} — {formatMoney(r.outstanding, sym)} due
              </option>)}
            </Select>
          </div>
          <div><Label htmlFor="amount">Amount *</Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} required /></div>
          <div><Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div className="col-span-2"><Label>Paid from</Label>
            <Select name="payment_method_id"><option value="">— Cash drawer —</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Close</Button>
            <Button type="submit" disabled={pending || !shId || amount <= 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Pay {formatMoney(amount, sym)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
