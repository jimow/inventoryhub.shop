"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2, CheckCircle2, XCircle, Upload, Eye, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { DataTable, type Column, type FilterDef, type BulkAction } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { ImportDialog } from "@/components/import-dialog";
import { ExportButton } from "@/components/export-button";

import type { Customer, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, currencySymbol } from "@/lib/utils";
import {
  createCustomer, updateCustomer, deleteCustomer,
  bulkDeleteCustomers, bulkSetCustomerStatus,
  importCustomers, exportCustomers,
} from "./actions";

export function CustomersClient({
  customers, totalCount, settings, permissions,
}: {
  customers: Customer[];
  totalCount: number;
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sp = useSearchParams();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const sym = currencySymbol(settings);

  // Shown only to users granted the Customers → Balances permission.
  const canSeeBalance = can(permissions, "customers", "balances");
  const columns: Column<Customer>[] = [
    { key: "code", label: "Code", className: "w-[130px] font-medium",
      render: (r) => <Link href={`/customers/${r.id}`} className="text-blue-600 hover:underline font-mono">{r.code}</Link> },
    { key: "name", label: "Name",
      render: (r) => <Link href={`/customers/${r.id}`} className="hover:underline">{r.name}</Link> },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone", className: "w-[140px]" },
    { key: "city", label: "City", className: "w-[130px]" },
    { key: "credit_limit", label: "Credit", className: "w-[110px] text-right tabular-nums",
      render: (r) => formatMoney(r.credit_limit, sym) },
    ...(canSeeBalance ? [{
      key: "opening_balance", label: "Opening", className: "w-[110px] text-right tabular-nums text-slate-500",
      render: (r: Customer) => Number(r.opening_balance || 0) !== 0 ? formatMoney(Number(r.opening_balance), sym) : <span className="text-slate-300">—</span>,
    }, {
      key: "balance", label: "Balance", className: "w-[120px] text-right tabular-nums font-semibold",
      render: (r: Customer) => (
        <span className={Number(r.balance) > 0 ? "text-amber-700" : Number(r.balance) < 0 ? "text-emerald-700" : "text-slate-500"}>
          {formatMoney(r.balance, sym)}
        </span>
      ),
    }] : []),
    { key: "status", label: "Status", className: "w-[100px]",
      render: (r) => <Badge variant={r.status === "active" ? "success" : "secondary"}>{r.status}</Badge> },
  ];

  const filters: FilterDef[] = [{
    key: "status", label: "Status",
    options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }],
  }];

  const bulkActions: BulkAction<Customer>[] = [];
  if (can(permissions, "customers", "edit")) {
    bulkActions.push({ label: "Set active", icon: CheckCircle2, variant: "outline",
      run: (rows) => bulkSetCustomerStatus(rows.map((r) => r.id), "active") });
    bulkActions.push({ label: "Set inactive", icon: XCircle, variant: "outline",
      run: (rows) => bulkSetCustomerStatus(rows.map((r) => r.id), "inactive") });
  }
  if (can(permissions, "customers", "delete")) {
    bulkActions.push({ label: "Delete", icon: Trash2, variant: "destructive",
      run: (rows) => bulkDeleteCustomers(rows.map((r) => r.id)) });
  }

  return (
    <div>
      <PageHeader title="Customers" description="Customer directory">
        <ExportButton action={() => exportCustomers(sp.get("q") || undefined, sp.get("status") || undefined)} />
        {can(permissions, "customers", "create") && (
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
        )}
        {can(permissions, "customers", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Customer
          </Button>
        )}
      </PageHeader>

      <DataTable<Customer>
        columns={columns}
        data={customers}
        totalCount={totalCount}
        searchPlaceholder="Search customers by name, email, phone..."
        filters={filters}
        bulkActions={bulkActions}
        rowActions={(row) => (
          <>
            <Button asChild variant="ghost" size="icon" title="View statement" className="h-8 w-8">
              <Link href={`/customers/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
            {can(permissions, "sales", "create") && (
              <Button asChild variant="ghost" size="icon" title="New sale" className="h-8 w-8 text-blue-600">
                <Link href={`/sales?new=1&customer_id=${row.id}`}><Receipt className="h-4 w-4" /></Link>
              </Button>
            )}
            {can(permissions, "customers", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit" className="h-8 w-8">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "customers", "delete") && (
              <DeleteButton action={() => deleteCustomer(row.id)} />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <CustomerDialog customer={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Customers from CSV"
        templateHeaders={["Code", "Name", "Email", "Phone", "Address", "City", "Country", "Tax ID", "Credit Limit", "Status"]}
        action={importCustomers}
      />
    </div>
  );
}

function CustomerDialog({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = customer ? await updateCustomer(customer.id, fd) : await createCustomer(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(customer ? "Customer updated" : "Customer created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? "Edit Customer" : "New Customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-4"><Label htmlFor="code">Code *</Label>
            <Input id="code" name="code" defaultValue={customer?.code} placeholder="(auto)" /></div>
          <div className="col-span-8"><Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" defaultValue={customer?.name} required /></div>
          <div className="col-span-6"><Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={customer?.email ?? ""} /></div>
          <div className="col-span-6"><Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={customer?.phone ?? ""} /></div>
          <div className="col-span-12"><Label htmlFor="address">Address</Label>
            <Input id="address" name="address" defaultValue={customer?.address ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="city">City</Label>
            <Input id="city" name="city" defaultValue={customer?.city ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="country">Country</Label>
            <Input id="country" name="country" defaultValue={customer?.country ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="tax_id">Tax ID</Label>
            <Input id="tax_id" name="tax_id" defaultValue={customer?.tax_id ?? ""} /></div>
          <div className="col-span-6"><Label htmlFor="credit_limit">Credit Limit</Label>
            <Input id="credit_limit" name="credit_limit" type="number" step="0.01" min="0" defaultValue={customer?.credit_limit ?? 0} /></div>
          {!customer && (
            <>
              <div className="col-span-6"><Label htmlFor="opening_balance">Opening balance (owes us)</Label>
                <Input id="opening_balance" name="opening_balance" type="number" step="0.01" min="0" defaultValue={0} />
                <p className="text-[11px] text-muted-foreground mt-0.5">Posts Dr A/R · Cr Opening Balance Equity.</p>
              </div>
              <div className="col-span-6"><Label htmlFor="opening_date">As of date</Label>
                <Input id="opening_date" name="opening_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
            </>
          )}
          <div className="col-span-6"><Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={customer?.status || "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="col-span-12">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
