"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pencil, Plus, X, Trash2, CheckCircle2, XCircle, Upload, Sliders } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { DataTable, type Column, type FilterDef, type BulkAction } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { ImportDialog } from "@/components/import-dialog";
import { ExportButton } from "@/components/export-button";

import type { Product, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/utils";
import {
  createProduct, updateProduct, deleteProduct,
  bulkDeleteProducts, bulkSetProductStatus,
  importProducts, exportProducts, recordStockAdjustment,
} from "./actions";

export function ProductsClient({
  products, totalCount, settings, permissions,
}: {
  products: Product[];
  totalCount: number;
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sp = useSearchParams();
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const columns: Column<Product>[] = [
    { key: "code", label: "Code", className: "w-[120px] font-medium",
      render: (r) => <Link href={`/products/${r.id}`} className="text-blue-600 hover:underline font-mono">{r.code}</Link> },
    { key: "name", label: "Name",
      render: (r) => <Link href={`/products/${r.id}`} className="hover:underline">{r.name}</Link> },
    { key: "category", label: "Category", className: "w-[140px]" },
    { key: "sku", label: "SKU", className: "w-[120px]" },
    { key: "selling_price", label: "Sell Price", className: "w-[120px] text-right",
      render: (r) => formatMoney(r.selling_price, settings.currency?.symbol) },
    { key: "current_stock", label: "Stock", className: "w-[140px]",
      render: (r) => {
        const low = Number(r.current_stock || 0) <= Number(r.min_stock || 0);
        return <Badge variant={low ? "danger" : "success"}>{Number(r.current_stock || 0)} {r.unit}</Badge>;
      } },
    { key: "status", label: "Status", className: "w-[100px]",
      render: (r) => <Badge variant={r.status === "active" ? "success" : "secondary"}>{r.status}</Badge> },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: [
      { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" },
    ]},
    { key: "category", label: "Category",
      options: (settings.productCategories || []).map((c) => ({ value: c, label: c })) },
  ];

  const bulkActions: BulkAction<Product>[] = [];
  if (can(permissions, "products", "edit")) {
    bulkActions.push({ label: "Set active", icon: CheckCircle2, variant: "outline",
      run: (rows) => bulkSetProductStatus(rows.map((r) => r.id), "active") });
    bulkActions.push({ label: "Set inactive", icon: XCircle, variant: "outline",
      run: (rows) => bulkSetProductStatus(rows.map((r) => r.id), "inactive") });
  }
  if (can(permissions, "products", "delete")) {
    bulkActions.push({ label: "Delete", icon: Trash2, variant: "destructive",
      run: (rows) => bulkDeleteProducts(rows.map((r) => r.id)) });
  }

  return (
    <div>
      <PageHeader title="Products" description="Finished goods, optionally with bill of materials">
        <ExportButton action={() => exportProducts(sp.get("q") || undefined, sp.get("status") || undefined, sp.get("category") || undefined)} />
        {can(permissions, "products", "create") && (
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
        )}
        {can(permissions, "products", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Product
          </Button>
        )}
      </PageHeader>

      <DataTable<Product>
        columns={columns}
        data={products}
        totalCount={totalCount}
        searchPlaceholder="Search products by code, name, SKU..."
        filters={filters}
        bulkActions={bulkActions}
        rowActions={(row) => (
          <>
            {can(permissions, "products", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "products", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setAdjusting(row)} title="Adjust Stock" className="text-amber-600">
                <Sliders className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "products", "delete") && (
              <DeleteButton action={() => deleteProduct(row.id)} />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <ProductDialog product={editing} settings={settings}
          onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      {adjusting && (
        <StockAdjustDialog product={adjusting}
          onClose={() => setAdjusting(null)} />
      )}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Products from CSV"
        templateHeaders={["Code", "Name", "Category", "SKU", "Barcode", "Unit", "Cost", "Sell Price", "Stock", "Min Stock", "Status"]}
        action={importProducts}
      />
    </div>
  );
}

function ProductDialog({
  product, settings, onClose,
}: { product: Product | null; settings: SettingsData; onClose: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const isNew = !product;
  const [serialTracked, setSerialTracked] = useState<boolean>(product?.serial_tracked ?? false);
  const [currentStock, setCurrentStock] = useState<number>(Number(product?.current_stock ?? 0));
  const [initialSerials, setInitialSerials] = useState<string>("");
  const productCode = product?.code || "";

  const serialLines = initialSerials.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const serialCountOk = serialLines.length === currentStock;
  const needsSerials = isNew && serialTracked && currentStock > 0;

  function generatePlaceholders() {
    const n = Math.max(0, Math.floor(currentStock));
    if (n <= 0) return;
    const prefix = productCode ? `${productCode}-` : "SN-";
    const lines = Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(4, "0")}`);
    setInitialSerials(lines.join("\n"));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = product ? await updateProduct(product.id, fd) : await createProduct(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(product ? "Product updated" : "Product created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Product" : "New Product"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-4"><Label htmlFor="code">Code *</Label>
            <Input id="code" name="code" defaultValue={product?.code} placeholder="(auto)" /></div>
          <div className="col-span-8"><Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" defaultValue={product?.name} required /></div>
          <div className="col-span-4"><Label htmlFor="sku">SKU</Label>
            <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="barcode">Barcode</Label>
            <Input id="barcode" name="barcode" defaultValue={product?.barcode ?? ""} /></div>
          <div className="col-span-4"><Label htmlFor="category">Category</Label>
            <Select id="category" name="category" defaultValue={product?.category ?? settings.productCategories?.[0]}>
              {(settings.productCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="col-span-3"><Label htmlFor="unit">Unit</Label>
            <Select id="unit" name="unit" defaultValue={product?.unit || "pcs"}>
              {(settings.units || []).map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
          <div className="col-span-3"><Label htmlFor="cost_price">Cost</Label>
            <Input id="cost_price" name="cost_price" type="number" step="0.01" min="0" defaultValue={product?.cost_price ?? 0} /></div>
          <div className="col-span-3"><Label htmlFor="selling_price">Sell Price</Label>
            <Input id="selling_price" name="selling_price" type="number" step="0.01" min="0" defaultValue={product?.selling_price ?? 0} /></div>
          <div className="col-span-3"><Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={product?.status || "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="col-span-6"><Label htmlFor="current_stock">Current Stock</Label>
            <Input id="current_stock" name="current_stock" type="number" step="0.01" min="0"
              value={currentStock}
              onChange={(e) => setCurrentStock(Number(e.target.value) || 0)} /></div>
          <div className="col-span-6"><Label htmlFor="min_stock">Min Stock</Label>
            <Input id="min_stock" name="min_stock" type="number" step="0.01" min="0" defaultValue={product?.min_stock ?? 0} /></div>

          <div className="col-span-12 flex items-center gap-6 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="taxable" defaultChecked={product ? product.taxable : true} />
              <span className="text-sm">Taxable (counted in tax base)</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="serial_tracked"
                checked={serialTracked}
                onChange={(e) => setSerialTracked(e.target.checked)} />
              <span className="text-sm">Serial / barcode tracked</span>
            </label>
          </div>

          {needsSerials && (
            <div className="col-span-12 rounded-md border border-amber-300 bg-amber-50/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="initial_serials" className="text-amber-900">
                  Initial Serial Numbers · need {currentStock}, have {serialLines.length}
                </Label>
                <Button type="button" size="sm" variant="outline"
                  onClick={generatePlaceholders}
                  className="border-amber-400 text-amber-800">
                  Auto-fill {currentStock} placeholder{currentStock === 1 ? "" : "s"}
                </Button>
              </div>
              <Textarea id="initial_serials" name="initial_serials"
                rows={Math.min(8, Math.max(3, currentStock))}
                value={initialSerials}
                onChange={(e) => setInitialSerials(e.target.value)}
                placeholder={`One serial per line. Optional barcode after a "|" character.\n\ne.g.\nSN-000123\nSN-000124|BC-12345\nSN-000125`}
                className={serialCountOk ? "" : "border-amber-400 focus-visible:ring-amber-400"}
              />
              <p className="text-xs mt-1">
                {serialCountOk ? (
                  <span className="text-emerald-700">All {currentStock} serial(s) entered. Good to go.</span>
                ) : (
                  <span className="text-amber-800">
                    Enter one unique serial per unit. Click <b>Auto-fill</b> to seed placeholders, then edit each line.
                    You can append <code className="text-[10px] bg-amber-100 px-1 rounded">|barcode</code> after a serial if the unit has a printed barcode.
                  </span>
                )}
              </p>
            </div>
          )}

          <div className="col-span-12">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit"
                disabled={pending || (needsSerials && !serialCountOk)}
                title={needsSerials && !serialCountOk ? `Enter exactly ${currentStock} serial(s) first` : ""}>
                {pending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* STOCK ADJUSTMENT - shrinkage, damage, write-off, recount                   */
/* -------------------------------------------------------------------------- */
function StockAdjustDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [direction, setDirection] = useState<"down" | "up">("down");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<"shrinkage" | "damage" | "write_off" | "internal_use" | "found" | "count" | "other">("shrinkage");
  const [notes, setNotes] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("Quantity must be > 0"); return; }
    if (direction === "down" && q > Number(product.current_stock)) {
      toast.error(`Cannot reduce by more than current stock (${product.current_stock})`);
      return;
    }
    const signedQty = direction === "down" ? -q : q;
    const mappedReason = direction === "up"
      ? (reason === "shrinkage" || reason === "damage" || reason === "write_off" || reason === "internal_use" ? "found" : reason)
      : reason;
    start(async () => {
      const r = await recordStockAdjustment({
        product_id: product.id,
        qty_change: signedQty,
        reason: mappedReason,
        notes: notes || null,
      });
      if (!r.ok) { toast.error(r.error || "Failed"); return; }
      const valuation = Number(product.cost_price) * q;
      toast.success(`Stock ${direction === "down" ? "reduced" : "increased"} by ${q} (${valuation.toFixed(2)} value journalled)`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock - {product.name}</DialogTitle>
          <DialogDescription>
            Current stock: <b>{product.current_stock} {product.unit}</b>.
            Posts a journal at unit cost {Number(product.cost_price).toFixed(2)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-3">
            <label className="flex-1 cursor-pointer border rounded-md p-3 has-[:checked]:border-red-500 has-[:checked]:bg-red-50">
              <input type="radio" checked={direction === "down"} onChange={() => { setDirection("down"); setReason("shrinkage"); }} className="mr-2" />
              <b>Stock down</b>
              <div className="text-xs text-slate-500">Damage, theft, internal use, write-off</div>
            </label>
            <label className="flex-1 cursor-pointer border rounded-md p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
              <input type="radio" checked={direction === "up"} onChange={() => { setDirection("up"); setReason("found"); }} className="mr-2" />
              <b>Stock up</b>
              <div className="text-xs text-slate-500">Stock found / recount correction</div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qty">Quantity</Label>
              <Input id="qty" type="number" step="0.01" min="0.01" value={qty}
                onChange={(e) => setQty(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Select id="reason" value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}>
                {direction === "down" ? (
                  <>
                    <option value="shrinkage">Shrinkage (theft / loss)</option>
                    <option value="damage">Damage</option>
                    <option value="write_off">Write-off (expiry / obsolete)</option>
                    <option value="internal_use">Internal use</option>
                    <option value="other">Other</option>
                  </>
                ) : (
                  <>
                    <option value="found">Stock found</option>
                    <option value="count">Count correction</option>
                    <option value="other">Other</option>
                  </>
                )}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional internal note (e.g. broken in transit, recount on 2026-05-27)" />
          </div>
          <div className="bg-slate-50 rounded-md p-3 text-xs text-slate-600">
            <b>Journal preview:</b>{" "}
            {direction === "down" ? (
              <>Dr Inventory {reason === "write_off" ? "Write-off 5800" : "Adjustment 5700"} {(Number(qty) * Number(product.cost_price)).toFixed(2)} · Cr Inventory 1300 {(Number(qty) * Number(product.cost_price)).toFixed(2)}</>
            ) : (
              <>Dr Inventory 1300 {(Number(qty) * Number(product.cost_price)).toFixed(2)} · Cr Inventory Adjustment 5700 {(Number(qty) * Number(product.cost_price)).toFixed(2)}</>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending} variant={direction === "down" ? "destructive" : "default"}>
              {pending ? "Saving..." : "Record Adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
