import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const TYPE_BADGE: Record<string, "info" | "warning" | "secondary" | "success" | "danger"> = {
  asset: "info", liability: "warning", equity: "secondary", income: "success", expense: "danger",
};

type EntryRef = { date: string; entry_no: string; description: string | null; source_type: string | null };
type LineRow = { debit: number; credit: number; description: string | null; entry: EntryRef | EntryRef[] | null };

export default async function AccountLedgerPage({ params }: { params: Params }) {
  await requireViewPermission("accounting");
  const { id } = await params;
  const admin = createServiceClient();
  const tid = currentTenantId();

  let aq = admin.from("accounts").select("id, code, name, type, description").eq("id", id);
  if (tid) aq = aq.eq("tenant_id", tid);
  const { data: account } = await aq.maybeSingle();
  if (!account) notFound();

  let lq = admin
    .from("journal_lines")
    .select("debit, credit, description, entry:journal_entries(date, entry_no, description, source_type)")
    .eq("account_id", id)
    .limit(5000);
  if (tid) lq = lq.eq("tenant_id", tid);
  const [{ data: lineData }, settings] = await Promise.all([lq, getSettings()]);
  const sym = currencySymbol(settings);

  const lines = ((lineData as LineRow[]) || []).map((l) => {
    const e = Array.isArray(l.entry) ? l.entry[0] : l.entry;
    return {
      date: e?.date || "",
      entry_no: e?.entry_no || "",
      source: e?.source_type || "manual",
      description: l.description || e?.description || "",
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    };
  });
  lines.sort((a, b) => (a.date === b.date ? a.entry_no.localeCompare(b.entry_no) : a.date.localeCompare(b.date)));

  // Credit-natured accounts (liability/equity/income) increase with credits.
  // "In" = money/value flowing INTO the account (increasing its balance);
  // "Out" = flowing out (decreasing it) — derived from the natural side.
  const creditNatured = ["liability", "equity", "income"].includes(account.type as string);
  let running = 0;
  const rows = lines.map((l) => {
    const inAmt = creditNatured ? l.credit : l.debit;
    const outAmt = creditNatured ? l.debit : l.credit;
    running += inAmt - outAmt;
    return { ...l, inAmt, outAmt, running };
  });
  const totalIn = rows.reduce((s, r) => s + r.inAmt, 0);
  const totalOut = rows.reduce((s, r) => s + r.outAmt, 0);

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const balance = creditNatured ? totalCredit - totalDebit : totalDebit - totalCredit;

  return (
    <div className="space-y-5">
      <Link href="/chart-of-accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to chart of accounts
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            <span className="font-mono text-slate-500 mr-2">{account.code}</span>{account.name}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={TYPE_BADGE[account.type as string] || "secondary"}>{account.type}</Badge>
            {account.description && <span className="text-sm text-slate-500">{account.description}</span>}
          </div>
        </div>
        <Card className="px-5 py-3 text-right">
          <div className="text-xs uppercase tracking-wide text-slate-400">Current balance</div>
          <div className={`text-2xl font-bold tabular-nums ${balance < 0 ? "text-red-600" : "text-slate-900"}`}>
            {formatMoney(balance, sym)}
          </div>
          <div className="text-[11px] text-slate-400">
            in {formatMoney(totalIn, sym)} · out {formatMoney(totalOut, sym)}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b text-sm text-slate-600">
          {rows.length} movement{rows.length === 1 ? "" : "s"} — how this balance was arrived at
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Date</TableHead>
              <TableHead className="w-[120px]">Entry</TableHead>
              <TableHead className="w-[90px]">Source</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-[120px]">In</TableHead>
              <TableHead className="text-right w-[120px]">Out</TableHead>
              <TableHead className="text-right w-[130px]">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-slate-500 p-10">No movements on this account yet.</TableCell></TableRow>
            ) : rows.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap text-sm text-slate-600">{l.date ? formatDate(l.date) : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{l.entry_no}</TableCell>
                <TableCell><Badge variant="secondary">{l.source}</Badge></TableCell>
                <TableCell className="text-sm text-slate-700">{l.description}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">{l.inAmt ? formatMoney(l.inAmt, sym) : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className="text-right tabular-nums text-red-600">{l.outAmt ? formatMoney(l.outAmt, sym) : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{formatMoney(l.running, sym)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
