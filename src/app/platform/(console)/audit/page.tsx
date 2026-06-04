import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { createPlatformClient, getTenantOverview } from "@/lib/platform";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Promise<{ from?: string; to?: string; tenant?: string; q?: string }>;

export default async function PlatformAuditPage({ searchParams }: { searchParams: SP }) {
  const sp = (await searchParams) ?? {};
  const admin = createPlatformClient();

  let query = admin.from("platform_audit").select("*").order("created_at", { ascending: false }).limit(500);
  if (sp.from) query = query.gte("created_at", `${sp.from}T00:00:00`);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59.999`);
  if (sp.tenant) query = query.eq("tenant_id", sp.tenant);
  if (sp.q) query = query.ilike("action", `%${sp.q}%`);

  const [{ data: rows }, tenants] = await Promise.all([query, getTenantOverview()]);
  const list = rows || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Platform Audit Log</h1>
        <p className="text-sm text-slate-500">Every super-admin action across all workspaces.</p>
      </div>

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" name="from" type="date" defaultValue={sp.from || ""} className="w-40" />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" name="to" type="date" defaultValue={sp.to || ""} className="w-40" />
          </div>
          <div>
            <Label htmlFor="tenant">Workspace</Label>
            <Select id="tenant" name="tenant" defaultValue={sp.tenant || ""} className="w-52">
              <option value="">All workspaces</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="q">Action</Label>
            <Input id="q" name="q" defaultValue={sp.q || ""} placeholder="e.g. tenant.suspended" className="w-48" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">Apply</Button>
            <Button asChild size="sm" variant="outline"><a href="/platform/audit">Reset</a></Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b text-sm text-slate-600">{list.length} event{list.length === 1 ? "" : "s"}</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">When</TableHead>
              <TableHead className="w-[180px]">Admin</TableHead>
              <TableHead className="w-[160px]">Action</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-500 p-10">No events for these filters.</TableCell></TableRow>
            ) : list.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(a.created_at)}</TableCell>
                <TableCell className="text-sm text-slate-700">{a.admin_email || "system"}</TableCell>
                <TableCell className="text-sm font-medium text-slate-800">{a.action}</TableCell>
                <TableCell className="text-sm text-slate-600">{a.tenant_name || "—"}</TableCell>
                <TableCell className="text-xs text-slate-500 font-mono">
                  {a.detail && Object.keys(a.detail).length ? JSON.stringify(a.detail) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
