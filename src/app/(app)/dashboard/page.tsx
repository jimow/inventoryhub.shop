import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getLedgerSnapshot } from "@/lib/ledger";
import { can } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import { DashboardRange } from "./range-tabs";
import {
  Package, Users, Truck, Receipt, ShoppingCart, CircleDollarSign,
  AlertTriangle, CheckCircle2, Landmark, Wallet, ArrowDownToLine, ArrowUpFromLine, ShieldAlert,
} from "lucide-react";
import type { Product, Customer, Supplier, Sale, SettingsData, Purchase } from "@/lib/types";

export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<string, string> = {
  today: "Today", week: "This week", month: "This month", year: "This year", all: "All time",
};

/** First in-range date (inclusive), as YYYY-MM-DD, for the selected period. */
function rangeStart(range: string): string {
  const now = new Date();
  if (range === "all") return "0000-01-01";
  if (range === "year") return `${now.getFullYear()}-01-01`;
  if (range === "month") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  if (range === "week") {
    const d = new Date(now);
    const monday = (d.getDay() + 6) % 7; // days since Monday
    d.setDate(d.getDate() - monday);
    return d.toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10); // today
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireViewPermission("dashboard");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const range = ["today", "week", "month", "year", "all"].includes(sp.range || "") ? sp.range! : "today";
  const start = rangeStart(range);

  // What this user is allowed to see — each widget is gated by the relevant
  // module's view permission, not one blanket "dashboard" view.
  const show = {
    products: can(permissions, "products", "view"),
    customers: can(permissions, "customers", "view"),
    suppliers: can(permissions, "suppliers", "view"),
    sales: can(permissions, "sales", "view"),
    purchases: can(permissions, "purchases", "view"),
    finance: can(permissions, "accounting", "view"),
    payments: can(permissions, "payments", "view"),
  };

  const supabase = await createClient();
  const [
    { data: products },
    { data: customers },
    { data: suppliers },
    { data: sales },
    { data: purchases },
    cfg,
    { count: pendingApprovals },
    ledger,
  ] = await Promise.all([
    supabase.from("products").select("id, status, current_stock, cost_price, min_stock, unit, name, code"),
    supabase.from("customers").select("id, name"),
    supabase.from("suppliers").select("id"),
    supabase.from("sales").select("id, invoice_no, date, status, total, customer_id").order("date", { ascending: false }),
    supabase.from("purchases").select("id, date, status, total"),
    getSettings(),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("approval_status", "pending"),
    getLedgerSnapshot(),
  ]);

  const P = (products as Product[]) || [];
  const C = (customers as Customer[]) || [];
  const S = (suppliers as Supplier[]) || [];
  const SL = (sales as Sale[]) || [];
  const PU = (purchases as Purchase[]) || [];
  const sym = currencySymbol(cfg as SettingsData);

  // Period figures (operational): sum non-cancelled docs dated within range.
  const periodSales = SL.filter((x) => x.status !== "cancelled" && x.date >= start);
  const periodPurch = PU.filter((x) => x.status !== "cancelled" && x.date >= start);
  const periodSalesTotal = periodSales.reduce((s, x) => s + Number(x.total || 0), 0);
  const periodPurchTotal = periodPurch.reduce((s, x) => s + Number(x.total || 0), 0);

  const lowProducts = P.filter((p) => p.status === "active" && Number(p.current_stock || 0) <= Number(p.min_stock || 0));
  const lowCount = lowProducts.length;
  const recentSales = SL.slice(0, 6);
  const label = RANGE_LABEL[range];

  const Hero = ({ label, value, icon: Icon, gradient, sub }: { label: string; value: string; icon: React.ElementType; gradient: string; sub?: string }) => (
    <div className={`card-interactive rounded-xl p-4 text-white shadow-card-lg bg-gradient-to-br ${gradient}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/85">{label}</span>
        <div className="h-8 w-8 rounded-lg bg-white/15 flex items-center justify-center"><Icon className="h-4 w-4 text-white" /></div>
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums truncate">{value}</div>
      {sub && <div className="text-[11px] text-white/75 mt-0.5">{sub}</div>}
    </div>
  );

  const Stat = ({ label, value, icon: Icon, color, sub }: { label: string; value: string | number; icon: React.ElementType; color: string; sub?: string }) => (
    <Card className="card-interactive">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-bold text-slate-900 truncate">{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Dashboard" />

      {/* Period filter — drives the Sales / Purchases cards */}
      {(show.sales || show.purchases) && (
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <span className="text-sm text-slate-500">Showing <b className="text-slate-700">{label}</b></span>
          <DashboardRange value={range} />
        </div>
      )}

      {/* Period money cards */}
      {(show.sales || show.purchases) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {show.sales && (
            <Stat label={`Sales · ${label}`} value={formatMoney(periodSalesTotal, sym)} icon={Receipt} color="bg-cyan-500"
              sub={`${periodSales.length} sale${periodSales.length === 1 ? "" : "s"}`} />
          )}
          {show.purchases && (
            <Stat label={`Purchases · ${label}`} value={formatMoney(periodPurchTotal, sym)} icon={ShoppingCart} color="bg-red-500"
              sub={`${periodPurch.length} order${periodPurch.length === 1 ? "" : "s"}`} />
          )}
          {show.sales && show.purchases && (
            <Stat label={`Net · ${label}`} value={formatMoney(periodSalesTotal - periodPurchTotal, sym)} icon={CircleDollarSign} color="bg-violet-500"
              sub="Sales − Purchases" />
          )}
          {show.payments && Number(pendingApprovals || 0) > 0 && (
            <Link href="/payments">
              <Stat label="Awaiting approval" value={Number(pendingApprovals || 0)} icon={ShieldAlert} color="bg-amber-500"
                sub="Payments pending sign-off" />
            </Link>
          )}
        </div>
      )}

      {/* Finance snapshot (ledger-derived) — gradient hero cards */}
      {show.finance && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Hero label="Cash & Bank" value={formatMoney(ledger.cashAndBank, sym)} icon={Wallet} gradient="from-teal-500 to-emerald-600" />
          <Hero label="Receivables (A/R)" value={formatMoney(ledger.receivables, sym)} icon={ArrowDownToLine} gradient="from-blue-500 to-indigo-600" />
          <Hero label="Payables (A/P)" value={formatMoney(ledger.payables, sym)} icon={ArrowUpFromLine} gradient="from-orange-500 to-rose-600" />
          <Hero label="Total Equity" value={formatMoney(ledger.totalEquity, sym)} icon={Landmark} gradient="from-violet-500 to-purple-600" />
        </div>
      )}

      {/* Master-data counts — each card links to its list */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {show.products && <Link href="/products"><Stat label="Products" value={P.length} icon={Package} color="bg-blue-500" /></Link>}
        {show.customers && <Link href="/customers"><Stat label="Customers" value={C.length} icon={Users} color="bg-emerald-500" /></Link>}
        {show.suppliers && <Link href="/suppliers"><Stat label="Suppliers" value={S.length} icon={Truck} color="bg-amber-500" /></Link>}
        {show.products && <Link href="/products"><Stat label="Inventory Value" value={formatMoney(ledger.inventory, sym)} icon={CircleDollarSign} color="bg-sky-500" /></Link>}
        {show.products && <Link href="/products"><Stat label="Low Stock" value={lowCount} icon={AlertTriangle} color="bg-orange-500" sub={lowCount > 0 ? "Tap to reorder" : undefined} /></Link>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {show.sales && (
          <Card className="lg:col-span-7">
            <div className="p-4 border-b">
              <div className="font-semibold text-slate-900">Recent Sales</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left p-3">Invoice</th>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Customer</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No sales yet</td></tr>
                  ) : (
                    recentSales.map((s) => {
                      const cust = C.find((c) => c.id === s.customer_id);
                      return (
                        <tr key={s.id} className="border-t hover:bg-slate-50">
                          <td className="p-3 font-medium">
                            <Link href="/sales" className="text-blue-600 hover:underline">{s.invoice_no}</Link>
                          </td>
                          <td className="p-3">{formatDate(s.date)}</td>
                          <td className="p-3">
                            {cust ? <Link href={`/customers/${cust.id}`} className="text-blue-600 hover:underline">{cust.name}</Link> : "-"}
                          </td>
                          <td className="p-3">
                            <Badge variant={s.status === "paid" ? "success" : s.status === "confirmed" ? "info" : s.status === "cancelled" ? "danger" : "secondary"}>
                              {s.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">{formatMoney(s.total, sym)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {show.products && (
          <Card className={show.sales ? "lg:col-span-5" : "lg:col-span-12"}>
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold text-slate-900">Low Stock Alerts</div>
              <Badge variant={lowCount === 0 ? "success" : "warning"}>{lowCount}</Badge>
            </div>
            <div className="p-4 max-h-96 overflow-y-auto">
              {lowCount === 0 ? (
                <div className="text-center text-muted-foreground py-6">
                  <CheckCircle2 className="h-8 w-8 mx-auto opacity-50 mb-2" />
                  All stock levels OK
                </div>
              ) : (
                <ul className="divide-y">
                  {lowProducts.map((p) => (
                    <li key={p.id}>
                      <Link href={`/products/${p.id}`} className="flex items-center justify-between py-2 -mx-2 px-2 rounded-lg hover:bg-slate-50">
                        <div>
                          <div className="font-medium text-blue-600 hover:underline">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.code}</div>
                        </div>
                        <Badge variant="danger">
                          {Number(p.current_stock || 0)} / {Number(p.min_stock || 0)} {p.unit}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
