"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2, CheckCircle2, XCircle, Upload, Eye, ShoppingCart } from "lucide-react";
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

import type { Supplier, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, currencySymbol } from "@/lib/utils";
import {
  createSupplier, updateSupplier, deleteSupplier,
  bulkDeleteSuppliers, bulkSetSupplierStatus,
  importSuppliers, exportSuppliers,
} from "./actions";

export function SuppliersClient({
  suppliers, totalCount, settings, permissions,
}: {
  suppliers: Supplier[];
  totalCount: number;
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sp = useSearchParams();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const sym = currencySymbol(settings);
  // Shown only to users granted the Suppliers → Balances permission.
  const canSeeBalance = can(permissions, "suppliers", "balances");

  const columns: Column<Supplier>[] = [
    { key: "code", label: "Code", className: "w-[130px] font-medium",
      render: (r) => <Link href={`/suppliers/${r.id}`} className="text-blue-600 hover:underline font-mono">{r.code}</Link> },
    { key: "name", label: "Name",
      render: (r) => <Link href={`/suppliers/${r.id}`} className="hover:underline">{r.name}</Link> },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone", className: "w-[140px]" },
    { key: "city", label: "City", className: "w-[130px]" },
    { key: "payment_terms", label: "Terms", className: "w-[110px]" },
    ...(canSeeBalance ? [{
      key: "opening_balance", label: "Opening", className: "w-[110px] text-right tabular-nums text-slate-500",
      render: (r: Supplier) => Number(r.opening_balance || 0) !== 0 ? formatMoney(Number(r.opening_balance), sym) : <span className="text-slate-300">—</span>,
    }, {
      key: "balance", label: "Balance", className: "w-[120px] text-right tabular-nums font-semibold",
      render: (r: Supplier) => (
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

  const bulkActions: BulkAction<Supplier>[] = [];
  if (can(permissions, "suppliers", "edit")) {
    bulkActions.push({ label: "Set active", icon: CheckCircle2, variant: "outline",
      run: (rows) => bulkSetSupplierStatus(rows.map((r) => r.id), "active") });
    bulkActions.push({ label: "Set inactive", icon: XCircle, variant: "outline",
      run: (rows) => bulkSetSupplierStatus(rows.map((r) => r.id), "inactive") });
  }
  if (can(permissions, "suppliers", "delete")) {
    bulkActions.push({ label: "Delete", icon: Trash2, variant: "destructive",
      run: (rows) => bulkDeleteSuppliers(rows.map((r) => r.id)) });
  }

  return (
    <div>
      <PageHeader title="Suppliers" description="Supplier directory">
        <ExportButton action={() => exportSuppliers(sp.get("q") || undefined, sp.get("status") || undefined)} />
        {can(permissions, "suppliers", "create") && (
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
        )}
        {can(permissions, "suppliers", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Supplier
          </Button>
        )}
      </PageHeader>

      <DataTable<Supplier>
        columns={columns}
        data={suppliers}
        totalCount={totalCount}
        searchPlaceholder="Search suppliers by name, email, phone..."
        filters={filters}
        bulkActions={bulkActions}
        rowActions={(row) => (
          <>
            <Button asChild variant="ghost" size="icon" title="View statement" className="h-8 w-8">
              <Link href={`/suppliers/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
            {can(permissions, "purchases", "create") && (
              <Button asChild variant="ghost" size="icon" title="New purchase" className="h-8 w-8 text-amber-600">
                <Link href={`/purchases?new=1&supplier_id=${row.id}`}><ShoppingCart className="h-4 w-4" /></Link>
              </Button>
            )}
            {can(permissions, "suppliers", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit" className="h-8 w-8">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "suppliers", "delete") && (
              <DeleteButton action={() => deleteSupplier(row.id)} />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <SupplierDialog supplier={editing} settings={settings} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Suppliers from CSV"
        templateHeaders={["Code", "Name", "Email", "Phone", "Address", "City", "Country", "Tax ID", "Payment Terms", "Status"]}
        action={importSuppliers}
      />
    </div>
  );
}

function SupplierDialog({ supplier, settings, onClose }: { supplier: Supplier | null; settings: SettingsData; onClose: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = supplier ? await updateSupplier(supplier.id, fd) : await createSupplier(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(supplier ? "Supplier updated" : "Supplier created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplier ? "Edit Supplier" : "New Supplier"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-4"><Label htmlFor="code">Code *</Label>
            <Input id="code" name="code" defaultValue={supplier?.code} placeholder="(auto)" /></div>
          <div className="col-span-8"><Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" defaultValue={supplier?.name} required /></div>
          <div className="col-span-6"><Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={supplier?.email ?? ""} /></div>
          <div className="col-span-6"><Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={supplier?.phone ?? ""} /></div>
          <div className="col-span-12"><Label htmlFor="address">Address</Label>
            <Input id="address" name="address" defaultValue={supplier?.address ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="city">City</Label>
            <Input id="city" name="city" defaultValue={supplier?.city ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="country">Country</Label>
            <Input id="country" name="country" defaultValue={supplier?.country ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="tax_id">Tax ID</Label>
            <Input id="tax_id" name="tax_id" defaultValue={supplier?.tax_id ?? ""} /></div>
          <div className="col-span-6"><Label htmlFor="payment_terms">Payment Terms</Label>
            <Select id="payment_terms" name="payment_terms" defaultValue={supplier?.payment_terms || "Net 30"}>
              {(settings.paymentTerms || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          {!supplier && (
            <>
              <div className="col-span-6"><Label htmlFor="opening_balance">Opening balance (we owe)</Label>
                <Input id="opening_balance" name="opening_balance" type="number" step="0.01" min="0" defaultValue={0} />
                <p className="text-[11px] text-muted-foreground mt-0.5">Posts Dr Opening Balance Equity · Cr A/P.</p>
              </div>
              <div className="col-span-6"><Label htmlFor="opening_date">As of date</Label>
                <Input id="opening_date" name="opening_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
            </>
          )}
          <div className="col-span-6"><Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={supplier?.status || "active"}>
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
