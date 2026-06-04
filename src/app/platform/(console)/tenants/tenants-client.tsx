"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, Plus, CheckCircle2, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TENANT_STATUS_META, type TenantStatus, type TenantOverviewRow } from "@/lib/platform-shared";
import { formatDateTime, formatDate } from "@/lib/utils";
import { changeTenantStatus, createWorkspace } from "./actions";

const STATUSES: TenantStatus[] = ["active", "read_only", "suspended", "locked"];

export function StatusBadge({ status }: { status: TenantStatus }) {
  const meta = TENANT_STATUS_META[status];
  return <Badge variant={meta.badge}>{meta.label}</Badge>;
}

export function TenantsClient({ tenants }: { tenants: TenantOverviewRow[] }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [managing, setManaging] = useState<TenantOverviewRow | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tenants.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        (t.slug || "").toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle)
      );
    });
  }, [tenants, q, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Workspaces</h1>
          <p className="text-sm text-slate-500">
            {tenants.length} workspace{tenants.length === 1 ? "" : "s"} on this database. Click one to troubleshoot.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New workspace</Button>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, slug or id…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{TENANT_STATUS_META[s].label}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="text-right w-[80px]">Users</TableHead>
              <TableHead className="text-right w-[90px]">Sales</TableHead>
              <TableHead className="w-[160px]">Last activity</TableHead>
              <TableHead className="w-[110px]">Created</TableHead>
              <TableHead className="w-[120px] text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500 p-10">No workspaces match.</TableCell>
              </TableRow>
            ) : rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={`/platform/tenants/${t.id}`} className="font-medium text-blue-600 hover:underline">
                    {t.name}
                  </Link>
                  <div className="text-xs text-slate-400 font-mono">{t.slug || t.id.slice(0, 8)}</div>
                </TableCell>
                <TableCell><StatusBadge status={t.status} /></TableCell>
                <TableCell className="text-right tabular-nums">{t.users.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{t.sales.toLocaleString()}</TableCell>
                <TableCell className="text-sm text-slate-500">
                  {t.last_activity ? formatDateTime(t.last_activity) : <span className="text-slate-400">—</span>}
                </TableCell>
                <TableCell className="text-sm text-slate-500">{formatDate(t.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setManaging(t)}>
                    <SlidersHorizontal className="h-3.5 w-3.5" /> Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {managing && <StatusDialog tenant={managing} onClose={() => setManaging(null)} />}
      {creating && <NewWorkspaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tenantId: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await createWorkspace(fd);
      if (!r.ok || !r.tenantId) { setError(r.error || "Failed."); return; }
      setDone({ tenantId: r.tenantId });
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Workspace provisioned</span>
            </div>
            <p className="text-sm text-slate-600">
              The workspace and its admin login are ready. To run it on a server, deploy it from the
              <span className="font-medium"> Servers</span> page, or pin a deployment with this tenant id:
            </p>
            <div className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2">
              <code className="text-xs font-mono text-slate-700 flex-1 truncate">TENANT_ID={done.tenantId}</code>
              <Button type="button" size="icon" variant="ghost"
                onClick={() => navigator.clipboard?.writeText(`TENANT_ID=${done.tenantId}`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button asChild variant="outline"><a href={`/platform/tenants/${done.tenantId}`}>Open workspace</a></Button>
              <Button type="button" onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
            {error && <div className="col-span-12 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
            <div className="col-span-7">
              <Label htmlFor="name">Workspace name *</Label>
              <Input id="name" name="name" required placeholder="e.g. Mombasa Branch" />
            </div>
            <div className="col-span-5">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" name="slug" placeholder="shop_mombasa" />
            </div>
            <div className="col-span-6">
              <Label htmlFor="currency_symbol">Currency symbol</Label>
              <Input id="currency_symbol" name="currency_symbol" placeholder="$ / KSh" />
            </div>
            <div className="col-span-6">
              <Label htmlFor="currency_code">Currency code</Label>
              <Input id="currency_code" name="currency_code" placeholder="USD / KES" />
            </div>
            <div className="col-span-12 pt-1 border-t mt-1"><span className="text-xs font-semibold text-slate-500">Administrator login</span></div>
            <div className="col-span-6">
              <Label htmlFor="admin_name">Admin name</Label>
              <Input id="admin_name" name="admin_name" placeholder="Full name" />
            </div>
            <div className="col-span-6">
              <Label htmlFor="admin_email">Admin email *</Label>
              <Input id="admin_email" name="admin_email" type="email" required />
            </div>
            <div className="col-span-12">
              <Label htmlFor="admin_password">Admin password *</Label>
              <Input id="admin_password" name="admin_password" type="password" minLength={8} required />
            </div>
            <div className="col-span-12">
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                <Button type="submit" disabled={pending}>{pending ? "Provisioning…" : "Create workspace"}</Button>
              </DialogFooter>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StatusDialog({
  tenant, onClose,
}: { tenant: TenantOverviewRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<TenantStatus>(tenant.status);
  const [reason, setReason] = useState(tenant.status_reason || "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const r = await changeTenantStatus(tenant.id, status, reason);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      onClose();
      router.refresh();
    });
  }

  const meta = TENANT_STATUS_META[status];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage “{tenant.name}”</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <Label htmlFor="status">Lifecycle status</Label>
            <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as TenantStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{TENANT_STATUS_META[s].label}</option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-slate-500">{meta.description}</p>
          </div>
          <div>
            <Label htmlFor="reason">Reason / note {meta.blocks || status === "read_only" ? "" : "(optional)"}</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Shown to the workspace's users when access is restricted."
            />
          </div>
          {meta.blocks && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              Users of this workspace will immediately lose access and see a notice.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
