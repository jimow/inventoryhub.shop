import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { createPlatformClient } from "@/lib/platform";
import { formatMoney, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SP = Promise<{ tab?: string }>;

type Col = { key: string; label: string; type?: "money" | "date" | "badge"; className?: string };

const TABS: Record<string, { label: string; table: string; order: string; cols: Col[] }> = {
  products: {
    label: "Products", table: "products", order: "name",
    cols: [
      { key: "code", label: "Code", className: "font-mono text-xs" },
      { key: "name", label: "Name" },
      { key: "category", label: "Category" },
      { key: "selling_price", label: "Price", type: "money", className: "text-right" },
      { key: "current_stock", label: "Stock", className: "text-right" },
      { key: "status", label: "Status", type: "badge" },
    ],
  },
  sales: {
    label: "Sales", table: "sales", order: "created_at",
    cols: [
      { key: "invoice_no", label: "Invoice", className: "font-mono text-xs" },
      { key: "date", label: "Date", type: "date" },
      { key: "total", label: "Total", type: "money", className: "text-right" },
      { key: "status", label: "Status", type: "badge" },
    ],
  },
  purchases: {
    label: "Purchases", table: "purchases", order: "created_at",
    cols: [
      { key: "po_no", label: "PO #", className: "font-mono text-xs" },
      { key: "date", label: "Date", type: "date" },
      { key: "total", label: "Total", type: "money", className: "text-right" },
      { key: "status", label: "Status", type: "badge" },
    ],
  },
  customers: {
    label: "Customers", table: "customers", order: "name",
    cols: [
      { key: "code", label: "Code", className: "font-mono text-xs" },
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "balance", label: "Balance", type: "money", className: "text-right" },
      { key: "status", label: "Status", type: "badge" },
    ],
  },
  suppliers: {
    label: "Suppliers", table: "suppliers", order: "name",
    cols: [
      { key: "code", label: "Code", className: "font-mono text-xs" },
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "balance", label: "Balance", type: "money", className: "text-right" },
      { key: "status", label: "Status", type: "badge" },
    ],
  },
};

export default async function TenantViewPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const tabKey = TABS[sp.tab || ""] ? (sp.tab as string) : "products";
  const tab = TABS[tabKey];

  const admin = createPlatformClient();
  const { data: tenant } = await admin.from("tenants").select("name").eq("id", id).maybeSingle();
  if (!tenant) notFound();

  const [{ data: settings }, { data: rows }] = await Promise.all([
    admin.from("settings").select("data").eq("tenant_id", id).maybeSingle(),
    admin.from(tab.table).select("*").eq("tenant_id", id).order(tab.order, { ascending: tab.order === "name" }).limit(200),
  ]);
  const sym: string = (settings?.data as { currency?: { symbol?: string } })?.currency?.symbol || "";
  const list = (rows || []) as Record<string, unknown>[];

  return (
    <div className="space-y-5">
      <Link href={`/platform/tenants/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to {tenant.name}
      </Link>

      <div className="flex items-center gap-2">
        <Eye className="h-5 w-5 text-slate-500" />
        <h1 className="text-2xl font-semibold text-slate-900">{tenant.name} — data viewer</h1>
      </div>
      <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 inline-block">
        Read-only. You are viewing this workspace's data exactly as stored — nothing here can be edited.
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b">
        {Object.entries(TABS).map(([key, t]) => (
          <Link
            key={key}
            href={`/platform/tenants/${id}/view?tab=${key}`}
            className={cn(
              "px-3 py-2 text-sm rounded-t-lg -mb-px border-b-2",
              key === tabKey
                ? "border-blue-600 text-blue-700 font-medium"
                : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b text-sm text-slate-600">{list.length} {tab.label.toLowerCase()}{list.length === 200 ? " (showing first 200)" : ""}</div>
        <Table>
          <TableHeader>
            <TableRow>
              {tab.cols.map((c) => <TableHead key={c.key} className={c.className}>{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow><TableCell colSpan={tab.cols.length} className="text-center text-slate-500 p-10">No {tab.label.toLowerCase()}.</TableCell></TableRow>
            ) : list.map((row, i) => (
              <TableRow key={(row.id as string) || i}>
                {tab.cols.map((c) => {
                  const v = row[c.key];
                  let content: React.ReactNode;
                  if (c.type === "money") content = formatMoney(Number(v || 0), sym);
                  else if (c.type === "date") content = v ? formatDate(v as string) : "—";
                  else if (c.type === "badge") content = <Badge variant={v === "active" || v === "paid" || v === "received" ? "success" : "secondary"}>{String(v ?? "—")}</Badge>;
                  else content = v == null || v === "" ? "—" : String(v);
                  return <TableCell key={c.key} className={cn("text-sm", c.className)}>{content}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
