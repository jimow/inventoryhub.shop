"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";

import type { Account, AccountType } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/utils";
import { createAccount, updateAccount, deleteAccount } from "./actions";

type Row = Account & { balance: number };

const TYPE_COLOR: Record<AccountType, "info" | "warning" | "success" | "secondary" | "danger"> = {
  asset: "info", liability: "warning", equity: "secondary", income: "success", expense: "danger",
};

export function ChartOfAccountsClient({
  accounts, permissions,
}: { accounts: Row[]; permissions: PermissionMatrix }) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);

  const columns: Column<Row>[] = [
    { key: "code", label: "Code", className: "w-[100px] font-mono font-medium" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type", className: "w-[110px]",
      render: (r) => <Badge variant={TYPE_COLOR[r.type] || "secondary"}>{r.type}</Badge> },
    { key: "balance", label: "Balance", className: "w-[140px] text-right",
      render: (r) => {
        const isCredit = r.type === "liability" || r.type === "equity" || r.type === "income";
        const display = isCredit ? -r.balance : r.balance;
        return <span className={display < 0 ? "text-red-600" : "text-slate-900"}>{formatMoney(display)}</span>;
      } },
    { key: "is_system", label: "System", className: "w-[90px]",
      render: (r) => r.is_system ? <Badge variant="secondary">System</Badge> : "" },
    { key: "is_active", label: "Status", className: "w-[90px]",
      render: (r) => <Badge variant={r.is_active ? "success" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
  ];

  const filters: FilterDef[] = [{
    key: "type", label: "Type",
    options: [
      { value: "asset", label: "Asset" }, { value: "liability", label: "Liability" },
      { value: "equity", label: "Equity" }, { value: "income", label: "Income" },
      { value: "expense", label: "Expense" },
    ],
  }];

  return (
    <div>
      <PageHeader title="Chart of Accounts" description="General ledger account structure">
        {can(permissions, "accounting", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Account
          </Button>
        )}
      </PageHeader>

      <DataTable<Row>
        columns={columns}
        data={accounts}
        totalCount={accounts.length}
        searchPlaceholder="Search by code or name..."
        filters={filters}
        rowActions={(row) => (
          <>
            {can(permissions, "accounting", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "accounting", "delete") && !row.is_system && (
              <DeleteButton action={() => deleteAccount(row.id)} />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <AccountDialog account={editing} parents={accounts}
          onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </div>
  );
}

function AccountDialog({
  account, parents, onClose,
}: { account: Row | null; parents: Row[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = account ? await updateAccount(account.id, fd) : await createAccount(fd);
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
          <DialogTitle>{account ? "Edit Account" : "New Account"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-4"><Label htmlFor="code">Code *</Label>
            <Input id="code" name="code" defaultValue={account?.code} required readOnly={account?.is_system} />
          </div>
          <div className="col-span-8"><Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" defaultValue={account?.name} required />
          </div>
          <div className="col-span-6"><Label htmlFor="type">Type *</Label>
            <Select id="type" name="type" defaultValue={account?.type || "asset"} required disabled={account?.is_system}>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </Select>
          </div>
          <div className="col-span-6"><Label htmlFor="parent_id">Parent Account</Label>
            <Select id="parent_id" name="parent_id" defaultValue={account?.parent_id ?? ""}>
              <option value="">— None —</option>
              {parents.filter((p) => p.id !== account?.id).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </Select>
          </div>
          <div className="col-span-12"><Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={2} defaultValue={account?.description ?? ""} />
          </div>
          <div className="col-span-12 flex items-center gap-2">
            <input type="checkbox" id="is_active" name="is_active" defaultChecked={account ? account.is_active : true} />
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
