import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShoppingCart, Wallet, AlertTriangle, Banknote } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { requireViewPermission, getCurrentSession } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatDate } from "@/lib/utils";
import type { Supplier, Purchase, Payment } from "@/lib/types";

type SP = Promise<{ from?: string; to?: string; type?: string }>;

type Row = {
  ts: string;
  kind: "purchase" | "payment" | "expense";
  doc: string;
  detail: string;
  amount: number;
  status?: string;
  url?: string;
};

export default async function SupplierDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: SP;
}) {
  await requireViewPermission("suppliers");
  await getCurrentSession();
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createClient();
  const { data: supplier } = await supabase.from("suppliers").select("*").eq("id", id).single();
  if (!supplier) notFound();
  const s = supplier as Supplier;

  const [{ data: purchases }, { data: payments }] = await Promise.all([
    supabase.from("purchases").select("*").eq("supplier_id", id).order("date", { ascending: false }),
    supabase.from("payments").select("*").eq("supplier_id", id).eq("direction", "out").order("date", { ascending: false }),
  ]);

  const rows: Row[] = [];
  for (const po of (purchases || []) as Purchase[]) {
    if (po.status === "cancelled") continue;
    rows.push({
      ts: po.date,
      kind: "purchase",
      doc: po.po_no,
      detail: `${po.purchase_type} purchase - ${(po.items || []).length} line(s)`,
      amount: Number(po.total),
      status: po.status,
      url: `/purchases?q=${encodeURIComponent(po.po_no)}`,
    });
  }
  for (const p of (payments || []) as Payment[]) {
    const isExpense = p.source_type === "other";
    rows.push({
      ts: p.date,
      kind: isExpense ? "expense" : "payment",
      doc: p.payment_no,
      detail: p.notes || (isExpense ? "Direct expense" : "Supplier payment"),
      amount: Number(p.amount),
      url: `/payments?q=${encodeURIComponent(p.payment_no)}`,
    });
  }
  rows.sort((a, b) => b.ts.localeCompare(a.ts));

  const filtered = rows.filter((r) => {
    if (sp.from && r.ts < sp.from) return false;
    if (sp.to && r.ts > sp.to) return false;
    if (sp.type && r.kind !== sp.type) return false;
    return true;
  });

  const totalPurchased = (purchases || []).filter((x) => x.status !== "cancelled").reduce((sum, x) => sum + Number(x.total), 0);
  const totalPaid      = (payments || []).reduce((sum, x) => sum + Number(x.amount), 0);
  const outstanding    = (purchases || [])
    .filter((x) => x.status === "received")
    .reduce((sum, x) => sum + Math.max(0, Number(x.total) - Number(x.amount_paid || 0)), 0);
  const overdueCount   = (purchases || []).filter((x) => {
    if (!x.due_date || x.status === "paid" || x.status === "cancelled") return false;
    return new Date(x.due_date) < new Date();
  }).length;

  return (
    <div>
      <Link href="/suppliers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
        <ArrowLeft className="h-4 w-4" /> All suppliers
      </Link>
      <PageHeader title={s.name} description={`${s.code}${s.tax_id ? ` · Tax ID ${s.tax_id}` : ""}`}>
        <Badge variant={s.status === "active" ? "success" : "secondary"}>{s.status}</Badge>
      </PageHeader>

      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Info label="Email" value={s.email} />
          <Info label="Phone" value={s.phone} />
          <Info label="City"  value={s.city}  />
          <Info label="Payment Terms" value={s.payment_terms} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Total purchased"  value={formatMoney(totalPurchased)} icon={ShoppingCart} color="bg-amber-500" />
        <Stat label="Total paid"       value={formatMoney(totalPaid)}      icon={Wallet}       color="bg-emerald-500" />
        <Stat label="Outstanding"      value={formatMoney(outstanding)}    icon={Banknote}     color={outstanding > 0 ? "bg-red-500" : "bg-slate-400"} />
        <Stat label="Overdue POs"      value={String(overdueCount)}        icon={AlertTriangle} color={overdueCount > 0 ? "bg-red-500" : "bg-slate-400"} />
      </div>

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
                <option value="purchase">Purchases</option>
                <option value="payment">Payments</option>
                <option value="expense">Expenses</option>
              </select>
            </div>
            <div className="col-span-3 flex gap-2">
              <Button type="submit" size="sm">Filter</Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href={`/suppliers/${id}`}>Reset</Link>
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
                    {r.kind === "purchase"
                      ? <Badge variant="warning">Purchase</Badge>
                      : r.kind === "expense"
                        ? <Badge variant="secondary">Expense</Badge>
                        : <Badge variant="info">Payment</Badge>}
                  </td>
                  <td className="p-3 font-mono">
                    {r.url ? <Link href={r.url} className="text-blue-600 hover:underline">{r.doc}</Link> : r.doc}
                  </td>
                  <td className="p-3 text-slate-600">{r.detail}</td>
                  <td className={`p-3 text-right font-semibold ${r.kind === "purchase" ? "text-amber-700" : "text-emerald-700"}`}>
                    {r.kind === "purchase" ? "" : "-"}{formatMoney(r.amount)}
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
