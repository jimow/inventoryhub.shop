"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeftRight, Loader2, Warehouse, Store as StoreIcon, Boxes, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";

import type { SettingsData, PaymentMethod } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, currencySymbol } from "@/lib/utils";
import { transferStock, listTransferUnits } from "./actions";

export type StoreRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  current_stock: number;   // shop
  store_stock: number;     // store
  min_stock: number;
  serial_tracked: boolean;
  status: string;
};

export function StoreClient({
  products, methods, settings, permissions,
}: {
  products: StoreRow[];
  methods: PaymentMethod[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sym = currencySymbol(settings);
  const [transfer, setTransfer] = useState<StoreRow | null>(null);
  const canTransfer = can(permissions, "store", "create");

  const totals = useMemo(() => {
    let shop = 0, store = 0;
    for (const p of products) { shop += Number(p.current_stock) || 0; store += Number(p.store_stock) || 0; }
    return { shop, store, total: shop + store };
  }, [products]);

  const columns: Column<StoreRow>[] = [
    { key: "code", label: "Code", className: "w-[110px]",
      render: (r) => <Link href={`/products/${r.id}`} className="font-mono text-xs text-blue-600 hover:underline">{r.code}</Link> },
    { key: "name", label: "Product",
      render: (r) => (
        <span className="flex items-center gap-2">
          <Link href={`/products/${r.id}`} className="font-medium text-blue-600 hover:underline">{r.name}</Link>
          {r.serial_tracked && <Badge variant="info" className="text-[10px]">Serial</Badge>}
        </span>
      ) },
    { key: "store_stock", label: "In Store", className: "w-[110px] text-right",
      render: (r) => <span className="tabular-nums font-medium text-amber-700">{Number(r.store_stock).toLocaleString()}</span> },
    { key: "current_stock", label: "In Shop", className: "w-[110px] text-right",
      render: (r) => <span className="tabular-nums font-medium text-emerald-700">{Number(r.current_stock).toLocaleString()}</span> },
    { key: "total", label: "Total", className: "w-[100px] text-right",
      render: (r) => <span className="tabular-nums">{(Number(r.current_stock) + Number(r.store_stock)).toLocaleString()}</span> },
  ];

  return (
    <div>
      <PageHeader title="Store / Warehouse" description="Hold stock in the store and transfer it to the shop when it's ready to sell. Only shop stock can be sold." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center text-white"><Warehouse className="h-5 w-5" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">In store</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">{totals.store.toLocaleString()}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white"><StoreIcon className="h-5 w-5" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">In shop (sellable)</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">{totals.shop.toLocaleString()}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-white"><Boxes className="h-5 w-5" /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total units on hand</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">{totals.total.toLocaleString()}</div></div>
        </CardContent></Card>
      </div>

      <DataTable<StoreRow>
        columns={columns}
        data={products}
        totalCount={products.length}
        searchPlaceholder="Search products by name or code..."
        rowActions={canTransfer ? (row) => (
          <Button variant="outline" size="sm" onClick={() => setTransfer(row)}>
            <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer
          </Button>
        ) : undefined}
      />

      {transfer && (
        <TransferDialog row={transfer} methods={methods} sym={sym} onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); }} />
      )}
    </div>
  );
}

type UnitRow = { id: string; serial_no: string; barcode: string | null };

function TransferDialog({
  row, methods, sym, onClose, onDone,
}: { row: StoreRow; methods: PaymentMethod[]; sym: string; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [direction, setDirection] = useState<"to_shop" | "to_store">("to_shop");
  const [qty, setQty] = useState<number>(0);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [charge, setCharge] = useState<number>(0);
  const [paidFrom, setPaidFrom] = useState<string>("");

  // Serial picker
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingUnits, setLoadingUnits] = useState(false);

  const available = direction === "to_shop" ? Number(row.store_stock) : Number(row.current_stock);
  const srcLoc = direction === "to_shop" ? "store" : "shop";

  // Load the source-location units whenever direction changes (serial products).
  useEffect(() => {
    if (!row.serial_tracked) return;
    setLoadingUnits(true);
    setPicked(new Set());
    listTransferUnits(row.id, srcLoc).then((r) => {
      setUnits(r.ok ? (r.units || []) : []);
      setLoadingUnits(false);
    });
  }, [row.id, row.serial_tracked, srcLoc]);

  // For serial products the qty follows the number of units picked.
  const effectiveQty = row.serial_tracked ? picked.size : Math.max(0, Math.round(Number(qty) || 0));

  function toggle(id: string) {
    setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function submit() {
    const amount = effectiveQty;
    if (amount <= 0) { toast.error(row.serial_tracked ? "Select at least one serial unit" : "Enter a quantity"); return; }
    if (!row.serial_tracked && amount > available) { toast.error(`Only ${available} available to move`); return; }
    if (charge > 0 && !paidFrom) { toast.error("Choose the account the charge is paid from"); return; }
    start(async () => {
      const r = await transferStock({
        productId: row.id,
        qty: amount,
        direction,
        reference,
        notes,
        charge,
        chargePaidFrom: paidFrom || null,
        unitIds: row.serial_tracked ? Array.from(picked) : undefined,
      });
      if (!r.ok) { toast.error(r.error || "Transfer failed"); return; }
      toast.success(`Moved ${amount} ${row.unit || "unit(s)"} ${direction === "to_shop" ? "to shop" : "to store"}`);
      onDone();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer — {row.name}</DialogTitle>
          <DialogDescription>
            Store: <b>{Number(row.store_stock).toLocaleString()}</b> · Shop: <b>{Number(row.current_stock).toLocaleString()}</b>
            {row.serial_tracked && <> · <span className="text-blue-600">serial-tracked</span></>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Direction</Label>
              <Select value={direction} onChange={(e) => setDirection(e.target.value as "to_shop" | "to_store")}>
                <option value="to_shop">Store → Shop</option>
                <option value="to_store">Shop → Store</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="t_ref">Reference</Label>
              <Input id="t_ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {row.serial_tracked ? (
            <div>
              <Label>Select serial units in the {srcLoc} ({picked.size} selected)</Label>
              <div className="mt-1 border rounded-md max-h-52 overflow-y-auto divide-y">
                {loadingUnits ? (
                  <div className="p-4 text-center text-slate-400 text-sm"><Loader2 className="h-4 w-4 animate-spin inline" /> Loading units…</div>
                ) : units.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-sm">No units in the {srcLoc}.</div>
                ) : units.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                    <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
                    <ScanLine className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-mono">{u.serial_no}</span>
                    {u.barcode && <span className="text-xs text-slate-400">· {u.barcode}</span>}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="t_qty">Quantity (available: {available.toLocaleString()})</Label>
              <Input id="t_qty" type="number" min="1" step="1" value={qty || ""} onChange={(e) => setQty(Number(e.target.value) || 0)} placeholder="0" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t_charge">Transport / handling charge</Label>
              <Input id="t_charge" type="number" min="0" step="0.01" value={charge || ""} onChange={(e) => setCharge(Number(e.target.value) || 0)} placeholder="0.00" />
            </div>
            <div>
              <Label>Charge paid from</Label>
              <Select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} disabled={charge <= 0}>
                <option value="">— Cash drawer —</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
          </div>
          {charge > 0 && (
            <p className="text-[11px] text-slate-500">
              Posts a journal for {formatMoney(charge, sym)} — capitalized into inventory cost or expensed, per Settings → Accounting.
            </p>
          )}

          <div>
            <Label htmlFor="t_notes">Notes</Label>
            <Textarea id="t_notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || effectiveQty <= 0}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />} Transfer {effectiveQty > 0 ? effectiveQty : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
