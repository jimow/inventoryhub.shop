"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MODULE_LABELS, type Module } from "@/lib/permissions";
import type { SettingsData } from "@/lib/types";
import { formatMoney, formatDateTime, currencySymbol } from "@/lib/utils";

export type ActivityRow = {
  id: string;
  user_name: string | null;
  module: string;
  action: string;
  summary: string | null;
  entity_type: string | null;
  amount: number | null;
  created_at: string;
};

const MODULE_BADGE: Record<string, "info" | "success" | "warning" | "danger" | "secondary" | "default"> = {
  sales: "info", purchases: "warning", payments: "success", returns: "danger", accounting: "secondary",
};

export function ActivityLogClient({
  rows, users, settings, filters,
}: {
  rows: ActivityRow[];
  users: { id: string; name: string }[];
  settings: SettingsData;
  filters: { from: string; to: string; module: string; user: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [mod, setMod] = useState(filters.module);
  const [user, setUser] = useState(filters.user);

  // Modules that can appear in the log (subset of all modules + 'accounting').
  const moduleOptions = (Object.keys(MODULE_LABELS) as Module[]).filter((m) =>
    ["sales", "purchases", "payments", "returns", "accounting", "payroll", "equity", "loans"].includes(m),
  );

  function apply() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (mod) p.set("module", mod);
    if (user) p.set("user", user);
    start(() => router.push(`/activity-log${p.toString() ? `?${p}` : ""}`));
  }
  function reset() {
    setFrom(""); setTo(""); setMod(""); setUser("");
    start(() => router.push("/activity-log"));
  }

  const hasFilters = from || to || mod || user;

  return (
    <div>
      <PageHeader title="Activity Log" description="Every transaction recorded in the system — who did what, and when." />

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label htmlFor="mod">Module</Label>
            <Select id="mod" value={mod} onChange={(e) => setMod(e.target.value)} className="w-44">
              <option value="">All modules</option>
              {moduleOptions.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="user">User</Label>
            <Select id="user" value={user} onChange={(e) => setUser(e.target.value)} className="w-48">
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={apply} disabled={pending}>Apply</Button>
            {hasFilters && <Button size="sm" variant="outline" onClick={reset} disabled={pending}><X className="h-3.5 w-3.5" /> Reset</Button>}
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b flex items-center gap-2 text-sm text-slate-600">
          <History className="h-4 w-4" /> {rows.length} event{rows.length === 1 ? "" : "s"}{hasFilters ? " (filtered)" : ""}
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-[170px]">When</TableHead>
            <TableHead className="w-[160px]">User</TableHead>
            <TableHead className="w-[120px]">Module</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead className="text-right w-[140px]">Amount</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground p-10">No activity for these filters.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(r.created_at)}</TableCell>
                <TableCell className="text-sm font-medium text-slate-800">{r.user_name || <span className="text-slate-400">system</span>}</TableCell>
                <TableCell><Badge variant={MODULE_BADGE[r.module] || "secondary"}>{MODULE_LABELS[r.module as Module] || r.module}</Badge></TableCell>
                <TableCell className="text-sm text-slate-700">{r.summary || r.action}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{r.amount != null ? formatMoney(Number(r.amount), sym) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
