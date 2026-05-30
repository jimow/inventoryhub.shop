import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import {
  Package,
  Users,
  Truck,
  Receipt,
  ShoppingCart,
  CircleDollarSign,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type {
  Product,
  Customer,
  Supplier,
  Sale,
  SettingsData,
  Purchase,
} from "@/lib/types";

export default async function DashboardPage() {
  await requireViewPermission("dashboard");
  await getCurrentSession();
  const supabase = await createClient();

  const [
    { data: products },
    { data: customers },
    { data: suppliers },
    { data: sales },
    { data: purchases },
    { data: settings },
  ] = await Promise.all([
    supabase.from("products").select("id, status, current_stock, cost_price, min_stock, unit, name, code"),
    supabase.from("customers").select("id, name"),
    supabase.from("suppliers").select("id"),
    supabase.from("sales").select("id, invoice_no, date, status, total, customer_id").order("date", { ascending: false }),
    supabase.from("purchases").select("id, status, total"),
    supabase.from("settings").select("data").eq("id", 1).single(),
  ]);

  const P = (products as Product[]) || [];
  const C = (customers as Customer[]) || [];
  const S = (suppliers as Supplier[]) || [];
  const SL = (sales as Sale[]) || [];
  const PU = (purchases as Purchase[]) || [];
  const cfg = (settings?.data as SettingsData) || ({} as SettingsData);
  const sym = currencySymbol(cfg);

  const totalSales = SL.filter((x) => x.status !== "cancelled").reduce((s, x) => s + Number(x.total || 0), 0);
  const totalPurch = PU.filter((x) => x.status !== "cancelled").reduce((s, x) => s + Number(x.total || 0), 0);
  const inventoryValue =
    P.reduce((s, p) => s + Number(p.current_stock || 0) * Number(p.cost_price || 0), 0);
  const lowProducts = P.filter((p) => p.status === "active" && Number(p.current_stock || 0) <= Number(p.min_stock || 0));
  const lowCount = lowProducts.length;
  const recentSales = SL.slice(0, 5);

  const Stat = ({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) => (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-bold text-slate-900">{value}</div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Products" value={P.length} icon={Package} color="bg-blue-500" />
        <Stat label="Customers" value={C.length} icon={Users} color="bg-emerald-500" />
        <Stat label="Suppliers" value={S.length} icon={Truck} color="bg-amber-500" />
        <Stat label="Low Stock" value={lowCount} icon={AlertTriangle} color="bg-orange-500" />
        <Stat label="Total Sales" value={formatMoney(totalSales, sym)} icon={Receipt} color="bg-cyan-500" />
        <Stat label="Total Purchases" value={formatMoney(totalPurch, sym)} icon={ShoppingCart} color="bg-red-500" />
        <Stat label="Inventory Value" value={formatMoney(inventoryValue, sym)} icon={CircleDollarSign} color="bg-sky-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
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
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      No sales yet
                    </td>
                  </tr>
                ) : (
                  recentSales.map((s) => {
                    const cust = C.find((c) => c.id === s.customer_id);
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="p-3 font-medium">{s.invoice_no}</td>
                        <td className="p-3">{formatDate(s.date)}</td>
                        <td className="p-3">{cust?.name || "-"}</td>
                        <td className="p-3">
                          <Badge
                            variant={
                              s.status === "paid" ? "success"
                              : s.status === "confirmed" ? "info"
                              : s.status === "cancelled" ? "danger"
                              : "secondary"
                            }
                          >
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

        <Card className="lg:col-span-5">
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
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.code}</div>
                    </div>
                    <Badge variant="danger">
                      {Number(p.current_stock || 0)} / {Number(p.min_stock || 0)} {p.unit}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
