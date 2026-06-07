"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Banknote, Smartphone, Building2, CreditCard, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { DataTable, type Column } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";

import type { PaymentMethod, PaymentMethodKind, BankAccount } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/utils";
import { createPaymentMethod, updatePaymentMethod, deletePaymentMethod } from "./actions";

type AssetAccount = { id: string; code: string; name: string; type: string };

const KIND_ICON: Record<PaymentMethodKind, React.ElementType> = {
  cash: Banknote, mpesa: Smartphone, bank: Building2, card: CreditCard, other: MoreHorizontal,
};
const KIND_LABEL: Record<PaymentMethodKind, string> = {
  cash: "Cash", mpesa: "M-Pesa", bank: "Bank", card: "Card", other: "Other",
};
const KIND_COLOR: Record<PaymentMethodKind, "success" | "warning" | "info" | "secondary"> = {
  cash: "success", mpesa: "warning", bank: "info", card: "info", other: "secondary",
};

export function PaymentMethodsClient({
  methods, bankAccounts, assetAccounts, balanceByMethod, permissions,
}: {
  methods: PaymentMethod[];
  bankAccounts: BankAccount[];
  assetAccounts: AssetAccount[];
  balanceByMethod: Record<string, number>;
  permissions: PermissionMatrix;
}) {
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [adding, setAdding] = useState(false);
  const acctById = new Map(assetAccounts.map((a) => [a.id, a]));

  const columns: Column<PaymentMethod>[] = [
    { key: "name", label: "Account", className: "font-medium",
      render: (r) => {
        const Icon = KIND_ICON[r.kind] || MoreHorizontal;
        return (
          <span className="inline-flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {r.name}
          </span>
        );
      } },
    { key: "kind", label: "Type", className: "w-[100px]",
      render: (r) => <Badge variant={KIND_COLOR[r.kind] || "secondary"}>{KIND_LABEL[r.kind]}</Badge> },
    { key: "account_id", label: "Ledger account", render: (r) => {
      const a = r.account_id ? acctById.get(r.account_id) : undefined;
      return a ? <span className="font-mono text-xs">{a.code} · {a.name}</span> : <span className="text-amber-600 text-xs">⚠ not linked</span>;
    }},
    { key: "balance" as keyof PaymentMethod, label: "Balance", className: "w-[140px] text-right",
      render: (r) => {
        const bal = balanceByMethod[r.id] ?? 0;
        return <span className={`tabular-nums font-medium ${bal < 0 ? "text-red-600" : "text-slate-900"}`}>{formatMoney(bal)}</span>;
      } },
    { key: "is_active", label: "Status", className: "w-[90px]",
      render: (r) => <Badge variant={r.is_active ? "success" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Cash & Bank Accounts" description="Every place your money sits — cash tills, bank accounts, M-Pesa wallets — each tied to one ledger account.">
        {can(permissions, "accounting", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Method
          </Button>
        )}
      </PageHeader>

      <DataTable<PaymentMethod>
        columns={columns}
        data={methods}
        totalCount={methods.length}
        searchPlaceholder="Search payment methods..."
        rowActions={(row) => (
          <>
            {can(permissions, "accounting", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "accounting", "delete") && (
              <DeleteButton action={() => deletePaymentMethod(row.id)} />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <PaymentMethodDialog method={editing} bankAccounts={bankAccounts} assetAccounts={assetAccounts}
          onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </div>
  );
}

function PaymentMethodDialog({
  method, bankAccounts, assetAccounts, onClose,
}: {
  method: PaymentMethod | null;
  bankAccounts: BankAccount[];
  assetAccounts: AssetAccount[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const codeFor = (k: PaymentMethodKind) => (k === "mpesa" ? "1110" : k === "bank" || k === "card" ? "1100" : "1010");
  const suggestId = (k: PaymentMethodKind) => assetAccounts.find((a) => a.code === codeFor(k))?.id ?? "";
  const [kind, setKind] = useState<PaymentMethodKind>(method?.kind || "cash");
  const [accountId, setAccountId] = useState<string>(method?.account_id ?? suggestId(method?.kind || "cash"));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = method ? await updatePaymentMethod(method.id, fd) : await createPaymentMethod(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(method ? "Method updated" : "Method created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{method ? "Edit Payment Method" : "New Payment Method"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-7">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" defaultValue={method?.name} required />
          </div>
          <div className="col-span-5">
            <Label htmlFor="kind">Type *</Label>
            <Select id="kind" name="kind" value={kind} onChange={(e) => {
              const k = e.target.value as PaymentMethodKind;
              // If the account still matches the old suggestion, move it to the new one.
              if (!accountId || accountId === suggestId(kind)) setAccountId(suggestId(k));
              setKind(k);
            }} required>
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="col-span-12">
            <Label htmlFor="account_id">Ledger account (where the money sits) *</Label>
            <Select id="account_id" name="account_id" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="">— Select an asset account —</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Every payment in/out of this method posts to this account, so its balance is your real cash/bank position.
              Tip: create a <b>separate</b> account for each real till or bank so balances never get mixed up.
            </p>
          </div>
          <input type="hidden" name="bank_account_id" value={method?.bank_account_id ?? ""} />
          {kind === "mpesa" && (
            <>
              <div className="col-span-7">
                <Label htmlFor="mpesa_transaction_type">Lipa Na M-Pesa</Label>
                <Select id="mpesa_transaction_type" name="mpesa_transaction_type"
                  defaultValue={(method?.meta?.transaction_type as string) || "CustomerPayBillOnline"}>
                  <option value="CustomerPayBillOnline">PayBill (CustomerPayBillOnline)</option>
                  <option value="CustomerBuyGoodsOnline">Till / Buy Goods (CustomerBuyGoodsOnline)</option>
                </Select>
              </div>
              <div className="col-span-5">
                <Label htmlFor="mpesa_shortcode">PayBill / Till number</Label>
                <Input id="mpesa_shortcode" name="mpesa_shortcode"
                  defaultValue={(method?.meta?.shortcode as string) || "174379"}
                  placeholder="e.g. 174379" />
              </div>
              <p className="col-span-12 text-xs text-muted-foreground -mt-1">
                Sandbox PayBill 174379 works for both flavours. Replace with your live shortcode in production.
              </p>
            </>
          )}
          <div className="col-span-12 flex items-center gap-4 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="requires_ref"
                defaultChecked={method ? method.requires_ref : kind === "bank"} />
              <span className="text-sm">Requires reference / receipt code</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="is_active" defaultChecked={method ? method.is_active : true} />
              <span className="text-sm">Active</span>
            </label>
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
