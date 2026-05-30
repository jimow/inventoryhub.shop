import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt as ReceiptIcon, Wallet, PiggyBank, AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { requireViewPermission, getCurrentSession } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatDate } from "@/lib/utils";
import type { Customer, Sale, Payment } from "@/lib/types";

type SP = Promise<{ from?: string; to?: string; type?: string }>;

type Row = {
  ts: string;
  kind: "sale" | "receipt" | "deposit";
  doc: string;
  detail: string;
  amount: number;
  status?: string;
  url?: string;
};

export default async function CustomerDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: SP;
}) {
  await requireViewPermission("customers");
  await getCurrentSession();
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createClient();
  const { data: customer } = await supabase.from("customers").select("*").eq("id", id).single();
  if (!customer) notFound();
  const c = customer as Customer;

  const [{ data: sales }, { data: payments }] = await Promise.all([
    supabase.from("sales").select("*").eq("customer_id", id).order("date", { ascending: false }),
    supabase.from("payments").select("*").eq("customer_id", id).eq("direction", "in").order("date", { ascending: false }),
  ]);

  const rows: Row[] = [];
  for (const s of (sales || []) as Sale[]) {
    if (s.status === "cancelled") continue;
    rows.push({
      ts: s.date,
      kind: "sale",
      doc: s.invoice_no,
      detail: `${s.sale_type} sale - ${(s.items || []).length} line(s)`,
      amount: Number(s.total),
      status: s.status,
      url: `/sales?q=${encodeURIComponent(s.invoice_no)}`,
    });
  }
  for (const p of (payments || []) as Payment[]) {
    const isDeposit = p.source_type === "other";
    rows.push({
      ts: p.date,
      kind: isDeposit ? "deposit" : "receipt",
      doc: p.payment_no,
      detail: p.notes || (isDeposit ? "Customer deposit" : "Sale receipt"),
      amount: Number(p.amount),
      url: `/receipts?q=${encodeURIComponent(p.payment_no)}`,
    });
  }
  rows.sort((a, b) => b.ts.localeCompare(a.ts));

  const filtered = rows.filter((r) => {
    if (sp.from && r.ts < sp.from) return false;
    if (sp.to && r.ts > sp.to) return false;
    if (sp.type && r.kind !== sp.type) return false;
    return true;
  });

  const totalSales    = (sales || []).filter((s) => s.status !== "cancelled").reduce((sum, s) => sum + Number(s.total), 0);
  const totalReceived = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const outstanding   = (sales || [])
    .filter((s) => s.status === "confirmed")
    .reduce((sum, s) => sum + Math.max(0, Number(s.total) - Number(s.amount_paid || 0)), 0);
  const overdueCount  = (sales || []).filter((s) => {
    if (!s.due_date || s.status === "paid" || s.status === "cancelled") return false;
    return new Date(s.due_date) < new Date();
  }).length;

  return (
    <div>
      <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
        <ArrowLeft className="h-4 w-4" /> All customers
      </Link>
      <PageHeader title={c.name} description={`${c.code}${c.tax_id ? ` · Tax ID ${c.tax_id}` : ""}`}>
        <Badge variant={c.status === "active" ? "success" : "secondary"}>{c.status}</Badge>
      </PageHeader>

      {/* Contact */}
      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Info label="Email" value={c.email} />
          <Info label="Phone" value={c.phone} />
          <Info label="City"  value={c.city}  />
          <Info label="Address" value={c.address} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Total invoiced"  value={formatMoney(totalSales)}    icon={ReceiptIcon} color="bg-blue-500" />
        <Stat label="Total received"  value={formatMoney(totalReceived)} icon={Wallet}      color="bg-emerald-500" />
        <Stat label="Outstanding"     value={formatMoney(outstanding)}   icon={PiggyBank}   color={outstanding > 0 ? "bg-amber-500" : "bg-slate-400"} />
        <Stat label="Overdue invoices" value={String(overdueCount)}      icon={AlertTriangle} color={overdueCount > 0 ? "bg-red-500" : "bg-slate-400"} />
      </div>

      {/* Filter */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <form className="grid grid-cols-12 gap-3 items-end" action="">
            <div className="col-span-3">
              <label className="text-xs text-slate-500">From</label>
              <Input type="date" name="from" defaultValue={sp.from || ""} />
            </div>
            <div className="col-span-3">
              <label className="text-xs text-slate-500">To</label>
              <Input type="date" name="to" defaultValue={sp.to || ""} />
            </div>
            <div className="col-span-3">
              <label className="text-xs text-slate-500">Type</label>
              <select name="type" defaultValue={sp.type || ""} className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm">
                <option value="">All</option>
                <option value="sale">Sales</option>
                <option value="receipt">Receipts</option>
                <option value="deposit">Deposits</option>
              </select>
            </div>
            <div className="col-span-3 flex gap-2">
              <Button type="submit" size="sm">Filter</Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href={`/customers/${id}`}>Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <div className="p-4 border-b font-semibold text-slate-900">Activity ({filtered.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Document</th>
                <th className="text-left p-3">Detail</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No activity in this range.</td></tr>
              ) : filtered.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-3">{formatDate(r.ts)}</td>
                  <td className="p-3">
                    {r.kind === "sale"
                      ? <Badge variant="info">Sale</Badge>
                      : r.kind === "deposit"
                        ? <Badge variant="success">Deposit</Badge>
                        : <Badge variant="success">Receipt</Badge>}
                  </td>
                  <td className="p-3 font-mono">
                    {r.url ? <Link href={r.url} className="text-blue-600 hover:underline">{r.doc}</Link> : r.doc}
                  </td>
                  <td className="p-3 text-slate-600">{r.detail}</td>
                  <td className={`p-3 text-right font-semibold ${r.kind === "sale" ? "text-blue-700" : "text-emerald-700"}`}>
                    {r.kind === "sale" ? "" : "+"}{formatMoney(r.amount)}
                  </td>
                  <td className="p-3">{r.status ? <Badge variant="secondary">{r.status}</Badge> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-slate-900">{value || "-"}</div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-lg font-bold text-slate-900">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
