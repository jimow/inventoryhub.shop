"use client";

import { useState } from "react";
import Link from "next/link";
import { Undo2, RotateCcw, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { SalesReturn, PurchaseReturn, Customer, Supplier, Sale, Purchase, Product, PaymentMethod, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, formatDateTime, currencySymbol } from "@/lib/utils";
import { SalesReturnDialog, PurchaseReturnDialog } from "./return-dialogs";

export function ReturnsClient({
  salesReturns, purchaseReturns, returnableSales, returnablePurchases, products,
  customers, suppliers, methods, settings, permissions,
}: {
  salesReturns: SalesReturn[];
  purchaseReturns: PurchaseReturn[];
  returnableSales: Sale[];
  returnablePurchases: Purchase[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  methods: PaymentMethod[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const sym = currencySymbol(settings);
  const [tab, setTab] = useState<"sales" | "purchase">("sales");
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  const canCreate = can(permissions, "returns", "create");

  const [picking, setPicking] = useState<"sales" | "purchase" | null>(null);
  const [chosenSale, setChosenSale] = useState<Sale | null>(null);
  const [chosenPO, setChosenPO] = useState<Purchase | null>(null);

  const salesTotal = salesReturns.filter((r) => r.status === "posted").reduce((s, r) => s + Number(r.total), 0);
  const purchTotal = purchaseReturns.filter((r) => r.status === "posted").reduce((s, r) => s + Number(r.total), 0);

  return (
    <div>
      <PageHeader title="Returns" description="Sales returns (goods back from customers) and purchase returns (goods back to suppliers)">
        {canCreate && (
          <>
            <Button size="sm" variant="outline" onClick={() => setPicking("sales")}>
              <Plus className="h-4 w-4" /> New sales return
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPicking("purchase")}>
              <Plus className="h-4 w-4" /> New purchase return
            </Button>
          </>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Undo2 className="h-3.5 w-3.5" /> Sales returns</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{formatMoney(salesTotal, sym)}</div>
          <div className="text-[11px] text-muted-foreground">{salesReturns.length} record(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Purchase returns</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{formatMoney(purchTotal, sym)}</div>
          <div className="text-[11px] text-muted-foreground">{purchaseReturns.length} record(s)</div>
        </Card>
      </div>

      <Card className="p-2 mb-3 inline-flex gap-1">
        <button onClick={() => setTab("sales")} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "sales" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Sales returns</button>
        <button onClick={() => setTab("purchase")} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "purchase" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Purchase returns</button>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Return #</TableHead><TableHead>Date</TableHead>
            <TableHead>{tab === "sales" ? "Customer" : "Supplier"}</TableHead>
            <TableHead>Items</TableHead><TableHead>Refund</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {tab === "sales" ? (
              salesReturns.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground p-8">No sales returns yet.</TableCell></TableRow>
              ) : salesReturns.map((r) => {
                const c = custMap.get(r.customer_id || "");
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-medium">{r.return_no}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell>{c ? <Link href={`/customers/${c.id}`} className="text-blue-600 hover:underline">{c.name}</Link> : "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600">{(r.items || []).reduce((s, l) => s + Number(l.qty), 0)} unit(s)</TableCell>
                    <TableCell><Badge variant={r.refund_method === "cash" ? "warning" : "info"}>{r.refund_method === "cash" ? "Cash refund" : "Credit"}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{formatMoney(r.total, sym)}</TableCell>
                    <TableCell><Badge variant={r.status === "posted" ? "success" : "danger"}>{r.status}</Badge></TableCell>
                  </TableRow>
                );
              })
            ) : (
              purchaseReturns.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground p-8">No purchase returns yet.</TableCell></TableRow>
              ) : purchaseReturns.map((r) => {
                const s = supMap.get(r.supplier_id || "");
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-medium">{r.return_no}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell>{s ? <Link href={`/suppliers/${s.id}`} className="text-blue-600 hover:underline">{s.name}</Link> : "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600">{(r.items || []).reduce((sum, l) => sum + Number(l.qty), 0)} unit(s)</TableCell>
                    <TableCell><Badge variant={r.refund_method === "cash" ? "warning" : "info"}>{r.refund_method === "cash" ? "Cash refund" : "A/P credit"}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{formatMoney(r.total, sym)}</TableCell>
                    <TableCell><Badge variant={r.status === "posted" ? "success" : "danger"}>{r.status}</Badge></TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pick a source document to return against */}
      {picking === "sales" && (
        <PickDialog
          title="New sales return"
          description="Pick the sale the customer is returning goods from."
          placeholder="Search invoice or customer…"
          options={returnableSales.map((s) => ({
            value: s.id,
            label: `${s.invoice_no} · ${custMap.get(s.customer_id || "")?.name || "Walk-in"}`,
            sub: `${formatDate(s.date)} · ${formatMoney(s.total, sym)}`,
          }))}
          onPick={(id) => { const s = returnableSales.find((x) => x.id === id); if (s) { setChosenSale(s); setPicking(null); } }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === "purchase" && (
        <PickDialog
          title="New purchase return"
          description="Pick the purchase you're returning goods to the supplier from."
          placeholder="Search PO or supplier…"
          options={returnablePurchases.map((p) => ({
            value: p.id,
            label: `${p.po_no} · ${supMap.get(p.supplier_id || "")?.name || "—"}`,
            sub: `${formatDate(p.date)} · ${formatMoney(p.total, sym)}`,
          }))}
          onPick={(id) => { const p = returnablePurchases.find((x) => x.id === id); if (p) { setChosenPO(p); setPicking(null); } }}
          onClose={() => setPicking(null)}
        />
      )}

      {chosenSale && (
        <SalesReturnDialog sale={chosenSale} products={products} methods={methods} settings={settings}
          partyName={custMap.get(chosenSale.customer_id || "")?.name} onClose={() => setChosenSale(null)} />
      )}
      {chosenPO && (
        <PurchaseReturnDialog purchase={chosenPO} products={products} methods={methods} settings={settings}
          partyName={supMap.get(chosenPO.supplier_id || "")?.name} onClose={() => setChosenPO(null)} />
      )}
    </div>
  );
}

function PickDialog({
  title, description, placeholder, options, onPick, onClose,
}: {
  title: string; description: string; placeholder: string;
  options: { value: string; label: string; sub?: string }[];
  onPick: (id: string) => void; onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Combobox value="" onChange={onPick} options={options} placeholder={placeholder} emptyText="Nothing to return" />
      </DialogContent>
    </Dialog>
  );
}
