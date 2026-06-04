import Link from "next/link";
import { Building2, Users, Receipt, Package, CheckCircle2, PauseCircle, Lock, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTenantOverview, createPlatformClient, TENANT_STATUS_META, type TenantStatus } from "@/lib/platform";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function n(v: number) {
  return Number(v || 0).toLocaleString();
}

export default async function PlatformOverviewPage() {
  const admin = createPlatformClient();
  const [tenants, auditRes] = await Promise.all([
    getTenantOverview(),
    admin.from("platform_audit").select("*").order("created_at", { ascending: false }).limit(8),
  ]);
  const audit = auditRes.data || [];

  const byStatus = (s: TenantStatus) => tenants.filter((t) => t.status === s).length;
  const totals = tenants.reduce(
    (a, t) => ({
      users: a.users + t.users,
      products: a.products + t.products,
      sales: a.sales + t.sales,
      salesTotal: a.salesTotal + t.sales_total,
    }),
    { users: 0, products: 0, sales: 0, salesTotal: 0 }
  );

  const statCards = [
    { label: "Workspaces", value: tenants.length, icon: Building2, tint: "from-blue-500 to-indigo-600" },
    { label: "Total users", value: totals.users, icon: Users, tint: "from-violet-500 to-purple-600" },
    { label: "Sales recorded", value: totals.sales, icon: Receipt, tint: "from-emerald-500 to-teal-600" },
    { label: "Products tracked", value: totals.products, icon: Package, tint: "from-amber-500 to-orange-600" },
  ];

  const statusCards: { status: TenantStatus; icon: React.ElementType }[] = [
    { status: "active", icon: CheckCircle2 },
    { status: "read_only", icon: Eye },
    { status: "suspended", icon: PauseCircle },
    { status: "locked", icon: Lock },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Platform Overview</h1>
        <p className="text-sm text-slate-500">Health and usage across every workspace on this database.</p>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{n(s.value)}</p>
                </div>
                <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${s.tint} flex items-center justify-center shadow`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statusCards.map(({ status, icon: Icon }) => {
          const meta = TENANT_STATUS_META[status];
          return (
            <Card key={status} className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center">
                <Icon className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-900 tabular-nums">{byStatus(status)}</p>
                <p className="text-xs text-slate-500">{meta.label}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Tenants snapshot */}
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Workspaces</h2>
            <Link href="/platform/tenants" className="text-xs text-blue-600 hover:underline">View all →</Link>
          </div>
          <div className="divide-y">
            {tenants.length === 0 && (
              <div className="p-6 text-sm text-slate-500 text-center">No workspaces provisioned yet.</div>
            )}
            {tenants.slice(0, 8).map((t) => {
              const meta = TENANT_STATUS_META[t.status];
              return (
                <Link
                  key={t.id}
                  href={`/platform/tenants/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-sm font-semibold">
                    {(t.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{t.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {n(t.users)} users · {n(t.sales)} sales · {n(t.products)} products
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={meta.badge}>{meta.label}</Badge>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t.last_activity ? formatDateTime(t.last_activity) : "no activity"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        {/* Recent platform actions */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-slate-800">Recent admin actions</h2>
          </div>
          <div className="divide-y">
            {audit.length === 0 && (
              <div className="p-6 text-sm text-slate-500 text-center">No platform actions yet.</div>
            )}
            {audit.map((a) => (
              <div key={a.id} className="px-4 py-3">
                <p className="text-sm text-slate-800">
                  <span className="font-medium">{a.action}</span>
                  {a.tenant_name ? <span className="text-slate-500"> · {a.tenant_name}</span> : null}
                </p>
                <p className="text-[11px] text-slate-400">
                  {a.admin_email || "system"} · {formatDateTime(a.created_at)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
