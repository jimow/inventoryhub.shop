"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { DataTable, type Column } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";

import type { BankAccount, Account, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, currencySymbol } from "@/lib/utils";
import { createBankAccount, updateBankAccount, deleteBankAccount } from "./actions";

type Row = BankAccount & { current_balance: number };

export function BankAccountsClient({
  bankAccounts, assetAccounts, settings, permissions,
}: {
  bankAccounts: Row[];
  assetAccounts: Account[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);

  // App-level currency symbol (honors "numbers only" mode).
  const sym = currencySymbol(settings);
  // Per-account currency: still honor hideSymbol, otherwise show the bank
  // account's own currency code (e.g. "USD") or fall back to the app symbol.
  const hide = !!settings.currency?.hideSymbol;
  const bankSym = (currency: string | null | undefined) => hide ? "" : (currency || sym);

  const totalBalance = bankAccounts.reduce((s, b) => s + Number(b.current_balance || 0), 0);

  const columns: Column<Row>[] = [
    { key: "name", label: "Name", className: "font-medium" },
    { key: "bank_name", label: "Bank" },
    { key: "account_no", label: "Account #", className: "font-mono text-xs" },
    { key: "currency", label: "Currency", className: "w-[90px]" },
    { key: "opening_balance", label: "Opening", className: "w-[120px] text-right",
      render: (r) => formatMoney(r.opening_balance, bankSym(r.currency)) },
    { key: "current_balance", label: "Balance", className: "w-[140px] text-right font-semibold",
      render: (r) => <span className={r.current_balance < 0 ? "text-red-600" : "text-emerald-700"}>
        {formatMoney(r.current_balance, bankSym(r.currency))}
      </span> },
    { key: "is_active", label: "Status", className: "w-[90px]",
      render: (r) => <Badge variant={r.is_active ? "success" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Bank Accounts" description="Cash drawers, banks, M-Pesa tills">
        {can(permissions, "accounting", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Bank Account
          </Button>
        )}
      </PageHeader>

      <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
        <div className="text-xs uppercase tracking-wide text-blue-700/80">Total Balance Across Accounts</div>
        <div className="text-3xl font-bold text-blue-900 mt-1 tabular-nums">
          {formatMoney(totalBalance, sym)}
        </div>
      </Card>

      <DataTable<Row>
        columns={columns}
        data={bankAccounts}
        totalCount={bankAccounts.length}
        searchPlaceholder="Search bank accounts..."
        rowActions={(row) => (
          <>
            {can(permissions, "accounting", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "accounting", "delete") && (
              <DeleteButton action={() => deleteBankAccount(row.id)} />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <BankAccountDialog account={editing} assetAccounts={assetAccounts}
          onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </div>
  );
}

function BankAccountDialog({
  account, assetAccounts, onClose,
}: {
  account: Row | null;
  assetAccounts: Account[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = account ? await updateBankAccount(account.id, fd) : await createBankAccount(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(account ? "Account updated" : "Account created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "Edit Bank Account" : "New Bank Account"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-8">
            <Label htmlFor="name">Account Name *</Label>
            <Input id="name" name="name" defaultValue={account?.name} required placeholder="e.g. Equity Bank — Main" />
          </div>
          <div className="col-span-4">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue={account?.currency || "USD"} />
          </div>
          <div className="col-span-6">
            <Label htmlFor="bank_name">Bank Name</Label>
            <Input id="bank_name" name="bank_name" defaultValue={account?.bank_name ?? ""} />
          </div>
          <div className="col-span-6">
            <Label htmlFor="account_no">Account Number</Label>
            <Input id="account_no" name="account_no" defaultValue={account?.account_no ?? ""} />
          </div>
          <div className="col-span-6">
            <Label htmlFor="opening_balance">Opening Balance</Label>
            <Input id="opening_balance" name="opening_balance" type="number" step="0.01"
              defaultValue={account?.opening_balance ?? 0} />
          </div>
          <div className="col-span-6">
            <Label htmlFor="account_id">GL Account</Label>
            <Select id="account_id" name="account_id" defaultValue={account?.account_id ?? ""}>
              <option value="">— Select asset account —</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </Select>
          </div>
          <div className="col-span-12 flex items-center gap-2 pt-1">
            <input type="checkbox" id="is_active" name="is_active"
              defaultChecked={account ? account.is_active : true} />
            <Label htmlFor="is_active" className="cursor-pointer">Active</Label>
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
