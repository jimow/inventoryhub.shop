"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, Loader2, X, Pencil, Landmark, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
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

import type { Shareholder, EquityContribution, PaymentMethod, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { ownershipPercents, type OwnershipMode } from "@/lib/equity";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import { saveShareholder, deleteShareholder, recordContribution, cancelContribution } from "./actions";

export function EquityClient({
  shareholders, contributions, methods, settings,
  contributedEquity, retainedEarnings, equityTotal, permissions,
}: {
  shareholders: Shareholder[];
  contributions: EquityContribution[];
  methods: PaymentMethod[];
  settings: SettingsData;
  contributedEquity: number;
  retainedEarnings: number;
  equityTotal: number;
  permissions: PermissionMatrix;
}) {
  const sym = currencySymbol(settings);
  const [shDialog, setShDialog] = useState<{ open: boolean; edit: Shareholder | null }>({ open: false, edit: null });
  const [contribOpen, setContribOpen] = useState(false);

  const canCreate = can(permissions, "equity", "create");
  const canEdit = can(permissions, "equity", "edit");
  const canDelete = can(permissions, "equity", "delete");

  const shById = useMemo(() => new Map(shareholders.map((s) => [s.id, s])), [shareholders]);
  const mode: OwnershipMode = settings.equity?.ownershipMode === "fixed" ? "fixed" : "contribution";

  // Net capital per shareholder (contributions − withdrawals, posted only).
  const netByShareholder = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contributions) {
      if (c.status !== "posted") continue;
      const delta = c.kind === "contribution" ? Number(c.amount) : -Number(c.amount);
      m.set(c.shareholder_id, (m.get(c.shareholder_id) || 0) + delta);
    }
    return m;
  }, [contributions]);

  // Effective ownership %, computed identically to dividends (single source).
  const pct = useMemo(
    () => ownershipPercents(shareholders, contributions, mode),
    [shareholders, contributions, mode],
  );
  const totalOwnership = shareholders.reduce((s, sh) => s + (pct.get(sh.id) || 0), 0);

  return (
    <div>
      <PageHeader title="Equity & Shareholders" description="Owners and their capital contributions · posts double-entry to Owner Equity">
        {canCreate && (
          <>
            <Button size="sm" variant="outline" onClick={() => setShDialog({ open: true, edit: null })}>
              <Users className="h-4 w-4" /> Add shareholder
            </Button>
            <Button size="sm" onClick={() => setContribOpen(true)} disabled={shareholders.length === 0}>
              <Plus className="h-4 w-4" /> Record contribution
            </Button>
          </>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white"><Landmark className="h-5 w-5" /></div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total equity</div>
            <div className="text-lg font-bold text-slate-900">{formatMoney(equityTotal, sym)}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              Capital {formatMoney(contributedEquity, sym)} · Retained {formatMoney(retainedEarnings, sym)}
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center text-white"><Users className="h-5 w-5" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Shareholders</div>
            <div className="text-lg font-bold text-slate-900">{shareholders.length}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ownership allocated</div>
          <div className={`text-lg font-bold mt-1 ${Math.abs(totalOwnership - 100) < 0.01 ? "text-slate-900" : "text-amber-700"}`}>
            {totalOwnership.toFixed(2)}%{mode === "fixed" && Math.abs(totalOwnership - 100) > 0.01 && " (≠ 100%)"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {mode === "contribution" ? "By contribution (auto)" : "Fixed % (manual)"} · set in Settings
          </div>
        </CardContent></Card>
      </div>

      {/* Shareholders */}
      <Card className="mb-6">
        <div className="px-4 py-3 border-b font-semibold text-slate-900">Shareholders</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Contact</TableHead>
            <TableHead className="text-right">Ownership</TableHead>
            <TableHead className="text-right">Net capital</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shareholders.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground p-8">No shareholders yet.</TableCell></TableRow>
            ) : shareholders.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}{s.code && <span className="text-xs text-slate-400 ml-1">({s.code})</span>}</TableCell>
                <TableCell className="text-sm text-slate-600">{s.email || s.phone || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{(pct.get(s.id) || 0).toFixed(2)}%</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{formatMoney(netByShareholder.get(s.id) || 0, sym)}</TableCell>
                <TableCell><Badge variant={s.status === "active" ? "success" : "secondary"}>{s.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {canEdit && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShDialog({ open: true, edit: s })}><Pencil className="h-4 w-4" /></Button>}
                  {canDelete && <DeleteBtn onConfirm={() => deleteShareholder(s.id)} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Contributions ledger */}
      <Card>
        <div className="px-4 py-3 border-b font-semibold text-slate-900">Contributions &amp; withdrawals</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Ref</TableHead><TableHead>Shareholder</TableHead>
            <TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {contributions.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground p-8">No contributions recorded.</TableCell></TableRow>
            ) : contributions.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap text-sm">{formatDate(c.date)}</TableCell>
                <TableCell className="font-mono text-xs">{c.contribution_no}</TableCell>
                <TableCell>{shById.get(c.shareholder_id)?.name || "—"}</TableCell>
                <TableCell>
                  {c.kind === "contribution"
                    ? <Badge variant="success" className="gap-1"><ArrowDownToLine className="h-3 w-3" /> Contribution</Badge>
                    : <Badge variant="warning" className="gap-1"><ArrowUpFromLine className="h-3 w-3" /> Withdrawal</Badge>}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{formatMoney(c.amount, sym)}</TableCell>
                <TableCell><Badge variant={c.status === "posted" ? "info" : "danger"}>{c.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {canEdit && c.status === "posted" && <CancelBtn onConfirm={() => cancelContribution(c.id)} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {shDialog.open && (
        <ShareholderDialog edit={shDialog.edit} onClose={() => setShDialog({ open: false, edit: null })} />
      )}
      {contribOpen && (
        <ContributionDialog shareholders={shareholders.filter((s) => s.status === "active")} methods={methods} sym={sym} onClose={() => setContribOpen(false)} />
      )}
    </div>
  );
}

function DeleteBtn({ onConfirm }: { onConfirm: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" disabled={pending}
      onClick={() => { if (!confirm("Delete this shareholder?")) return; start(async () => {
        const r = await onConfirm(); if (!r.ok) { toast.error(r.error || "Failed"); return; } toast.success("Deleted"); router.refresh();
      }); }}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
    </Button>
  );
}

function CancelBtn({ onConfirm }: { onConfirm: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="text-amber-600" disabled={pending}
      onClick={() => { if (!confirm("Cancel this entry? A reversing journal will be posted.")) return; start(async () => {
        const r = await onConfirm(); if (!r.ok) { toast.error(r.error || "Failed"); return; } toast.success("Cancelled & reversed"); router.refresh();
      }); }}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel
    </Button>
  );
}

function ShareholderDialog({ edit, onClose }: { edit: Shareholder | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await saveShareholder(fd, edit?.id);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(edit ? "Shareholder updated" : "Shareholder added");
      onClose(); router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{edit ? "Edit shareholder" : "Add shareholder"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label htmlFor="name">Name *</Label><Input id="name" name="name" defaultValue={edit?.name || ""} required /></div>
          <div><Label htmlFor="code">Code</Label><Input id="code" name="code" defaultValue={edit?.code || ""} placeholder="Optional" /></div>
          <div><Label htmlFor="ownership_pct">Ownership %</Label><Input id="ownership_pct" name="ownership_pct" type="number" step="0.001" min="0" max="100" defaultValue={edit?.ownership_pct ?? 0} /></div>
          <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" defaultValue={edit?.email || ""} /></div>
          <div><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" defaultValue={edit?.phone || ""} /></div>
          <div className="col-span-2"><Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={edit?.status || "active"}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="col-span-2"><Label htmlFor="notes">Notes</Label><Input id="notes" name="notes" defaultValue={edit?.notes || ""} placeholder="Optional" /></div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContributionDialog({ shareholders, methods, sym, onClose }: {
  shareholders: Shareholder[]; methods: PaymentMethod[]; sym: string; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"contribution" | "withdrawal">("contribution");
  const [source, setSource] = useState<"cash" | "opening">("cash");
  const [amount, setAmount] = useState<number>(0);
  const isOpening = kind === "contribution" && source === "opening";
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (amount <= 0) { toast.error("Enter an amount"); return; }
    start(async () => {
      const r = await recordContribution(fd);
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      toast.success(kind === "contribution" ? "Contribution recorded" : "Withdrawal recorded");
      onClose(); router.refresh();
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record capital {kind}</DialogTitle>
          <DialogDescription>
            {kind === "withdrawal"
              ? "Posts Dr Owner Equity · Cr Cash/Bank (can't exceed available funds)."
              : isOpening
                ? "Posts Dr Opening Balance Equity · Cr Owner Equity — claims a share of opening stock & balances already on the books."
                : "Posts Dr Cash/Bank · Cr Owner Equity."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Shareholder *</Label>
            <Select name="shareholder_id" required defaultValue={shareholders[0]?.id || ""}>
              {shareholders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div><Label>Type</Label>
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "contribution" | "withdrawal")}>
              <option value="contribution">Contribution (capital in)</option>
              <option value="withdrawal">Withdrawal (capital out)</option>
            </Select>
          </div>
          {kind === "contribution" ? (
            <div><Label>Capital type</Label>
              <Select name="source" value={source} onChange={(e) => setSource(e.target.value as "cash" | "opening")}>
                <option value="cash">Cash / bank deposit</option>
                <option value="opening">Opening balances / assets on the books</option>
              </Select>
            </div>
          ) : <div />}
          <div><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
          <div><Label htmlFor="amount">Amount *</Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} required />
          </div>
          {isOpening ? (
            <div className="col-span-1 self-end text-[11px] text-muted-foreground pb-2">
              Reclassifies existing Opening Balance Equity to this owner — no cash moves.
            </div>
          ) : (
            <div><Label>{kind === "contribution" ? "Received into" : "Paid from"}</Label>
              <Select name="payment_method_id">
                <option value="">— Cash drawer —</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          )}
          <div className="col-span-2"><Label htmlFor="notes">Notes</Label><Input id="notes" name="notes" placeholder="Optional" /></div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || amount <= 0}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Record {formatMoney(amount, sym)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
