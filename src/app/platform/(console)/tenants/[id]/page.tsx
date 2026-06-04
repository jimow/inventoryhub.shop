import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, Users, Package, ShoppingCart, Receipt, Building2,
  CheckCircle2, XCircle, AlertTriangle, Clock, Eye, Rocket,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createPlatformClient, getTenantOverview, type TenantStatus,
} from "@/lib/platform";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils";
import { MODULE_LABELS, type Module } from "@/lib/permissions";
import { ManagePanel, WorkspaceAdmin } from "./tenant-manage";
import { TenantUsers, type TUser, type TRole } from "./tenant-users";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

export default async function TenantDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const admin = createPlatformClient();

  const { data: tenant } = await admin.from("tenants").select("*").eq("id", id).maybeSingle();
  if (!tenant) notFound();

  const [
    overview,
    { data: profiles },
    { data: settings },
    { count: accountsCount },
    { data: activity },
    { data: recentSales },
    { data: recentPurchases },
    { data: rolesData },
  ] = await Promise.all([
    getTenantOverview(),
    admin.from("profiles").select("id, full_name, username, email, status, created_at, role_id, role:roles(name)").eq("tenant_id", id).order("created_at"),
    admin.from("settings").select("data").eq("tenant_id", id).maybeSingle(),
    admin.from("accounts").select("*", { count: "exact", head: true }).eq("tenant_id", id),
    admin.from("activity_log").select("*").eq("tenant_id", id).order("created_at", { ascending: false }).limit(15),
    admin.from("sales").select("invoice_no, date, total, status").eq("tenant_id", id).order("created_at", { ascending: false }).limit(6),
    admin.from("purchases").select("po_no, date, total, status").eq("tenant_id", id).order("created_at", { ascending: false }).limit(6),
    admin.from("roles").select("id, name").eq("tenant_id", id).order("name"),
  ]);

  const o = overview.find((t) => t.id === id);
  const sym: string = (settings?.data as { currency?: { symbol?: string } })?.currency?.symbol || "";
  const usersRaw = (profiles || []) as Array<{
    id: string; full_name: string | null; username: string | null; email: string | null;
    status: string | null; created_at: string; role_id: string | null; role: { name: string }[] | { name: string } | null;
  }>;
  const users: TUser[] = usersRaw.map((u) => ({
    id: u.id,
    full_name: u.full_name,
    username: u.username,
    email: u.email,
    status: u.status,
    role_id: u.role_id,
    roleName: Array.isArray(u.role) ? u.role[0]?.name ?? null : u.role?.name ?? null,
  }));
  const roles = (rolesData || []) as TRole[];
  const hasAdmin = users.some((u) => u.roleName === "Administrator" && u.status === "active");
  const lastActivityDays = daysSince(o?.last_activity ?? null);

  const stats = [
    { label: "Users", value: o?.users ?? users.length, icon: Users },
    { label: "Products", value: o?.products ?? 0, icon: Package },
    { label: "Customers", value: o?.customers ?? 0, icon: Building2 },
    { label: "Suppliers", value: o?.suppliers ?? 0, icon: Building2 },
    { label: "Sales", value: o?.sales ?? 0, icon: Receipt, money: o?.sales_total ?? 0 },
    { label: "Purchases", value: o?.purchases ?? 0, icon: ShoppingCart, money: o?.purchases_total ?? 0 },
  ];

  const checks: { ok: boolean; warn?: boolean; label: string; detail: string }[] = [
    { ok: (o?.users ?? 0) > 0, label: "Has users", detail: `${o?.users ?? 0} user account(s)` },
    { ok: hasAdmin, label: "Administrator assigned", detail: hasAdmin ? "An active Administrator exists" : "No active Administrator — users may be locked out" },
    { ok: (accountsCount ?? 0) > 0, label: "Chart of accounts seeded", detail: `${accountsCount ?? 0} accounts` },
    { ok: Boolean(settings), label: "Settings configured", detail: settings ? "Settings row present" : "No settings row" },
    {
      ok: lastActivityDays !== null && lastActivityDays <= 30,
      warn: lastActivityDays !== null && lastActivityDays > 30,
      label: "Recent activity",
      detail: lastActivityDays === null ? "No activity ever recorded" : `Last activity ${lastActivityDays} day(s) ago`,
    },
  ];

  return (
    <div className="space-y-6">
      <Link href="/platform/tenants" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to workspaces
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-xl font-semibold shrink-0">
          {(tenant.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-slate-900 truncate">{tenant.name}</h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{tenant.slug || tenant.id}</span> · created {formatDate(tenant.created_at)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button asChild size="sm" variant="outline">
            <Link href={`/platform/tenants/${tenant.id}/view`}><Eye className="h-4 w-4" /> View data</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/platform/servers?deploy=${tenant.id}`}><Rocket className="h-4 w-4" /> Deploy</Link>
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: stats + tables */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {stats.map((s) => {
              const Icon = s.icon;
              return (
                <Card key={s.label} className="p-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Icon className="h-4 w-4" />
                    <span className="text-xs">{s.label}</span>
                  </div>
                  <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                    {Number(s.value || 0).toLocaleString()}
                  </p>
                  {"money" in s && s.money != null && (
                    <p className="text-xs text-slate-500">{formatMoney(Number(s.money), sym)}</p>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Users */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b"><h2 className="text-sm font-semibold text-slate-800">Users ({users.length})</h2></div>
            <TenantUsers tenantId={tenant.id} users={users} roles={roles} />
          </Card>

          {/* Recent transactions */}
          <div className="grid sm:grid-cols-2 gap-6">
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b"><h2 className="text-sm font-semibold text-slate-800">Recent sales</h2></div>
              <div className="divide-y">
                {(recentSales || []).length === 0 && <div className="p-4 text-sm text-slate-400 text-center">None</div>}
                {(recentSales || []).map((s: { invoice_no: string; date: string; total: number; status: string }) => (
                  <div key={s.invoice_no} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{s.invoice_no}</p>
                      <p className="text-xs text-slate-400">{formatDate(s.date)} · {s.status}</p>
                    </div>
                    <span className="text-sm tabular-nums">{formatMoney(Number(s.total), sym)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b"><h2 className="text-sm font-semibold text-slate-800">Recent purchases</h2></div>
              <div className="divide-y">
                {(recentPurchases || []).length === 0 && <div className="p-4 text-sm text-slate-400 text-center">None</div>}
                {(recentPurchases || []).map((p: { po_no: string; date: string; total: number; status: string }) => (
                  <div key={p.po_no} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.po_no}</p>
                      <p className="text-xs text-slate-400">{formatDate(p.date)} · {p.status}</p>
                    </div>
                    <span className="text-sm tabular-nums">{formatMoney(Number(p.total), sym)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Activity feed */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b"><h2 className="text-sm font-semibold text-slate-800">Recent activity</h2></div>
            <div className="divide-y">
              {(activity || []).length === 0 && <div className="p-4 text-sm text-slate-400 text-center">No activity recorded.</div>}
              {(activity || []).map((a: { id: string; module: string; action: string; summary: string | null; user_name: string | null; amount: number | null; created_at: string }) => (
                <div key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 truncate">{a.summary || a.action}</p>
                    <p className="text-xs text-slate-400">
                      {MODULE_LABELS[a.module as Module] || a.module} · {a.user_name || "system"} · {formatDateTime(a.created_at)}
                    </p>
                  </div>
                  {a.amount != null && <span className="text-sm tabular-nums text-slate-600">{formatMoney(Number(a.amount), sym)}</span>}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: control + health */}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Lifecycle control</h2>
            <ManagePanel
              tenantId={tenant.id}
              name={tenant.name}
              status={(tenant.status as TenantStatus) || "active"}
              reason={tenant.status_reason ?? null}
              notes={tenant.notes ?? null}
            />
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Workspace administration</h2>
            <WorkspaceAdmin
              tenantId={tenant.id}
              name={tenant.name}
              slug={tenant.slug ?? null}
              plan={tenant.plan ?? null}
            />
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Health checks</h2>
            <ul className="space-y-3">
              {checks.map((c) => {
                const Icon = c.ok ? CheckCircle2 : c.warn ? AlertTriangle : XCircle;
                const color = c.ok ? "text-emerald-600" : c.warn ? "text-amber-600" : "text-red-600";
                return (
                  <li key={c.label} className="flex items-start gap-2.5">
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{c.label}</p>
                      <p className="text-xs text-slate-500">{c.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Details</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Tenant ID</dt>
                <dd className="font-mono text-xs text-slate-700 truncate">{tenant.id}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Slug</dt>
                <dd className="text-slate-700">{tenant.slug || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Plan</dt>
                <dd className="text-slate-700">{tenant.plan || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Status changed</dt>
                <dd className="text-slate-700">{tenant.status_changed_at ? formatDateTime(tenant.status_changed_at) : "—"}</dd>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs text-slate-500">
                  {lastActivityDays === null ? "No activity yet" : `Active ${lastActivityDays}d ago`}
                </span>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
