"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { DataTable, type Column, type FilterDef, type BulkAction } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { ExportButton } from "@/components/export-button";

import type { Profile, Role } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import {
  createUser, updateUser, deleteUser,
  bulkDeleteUsers, bulkSetUserStatus, exportUsers,
} from "./actions";

type ProfileRow = Profile & { role_name?: string | null };

export function UsersClient({
  users, totalCount, roles, permissions, currentUserId,
}: {
  users: ProfileRow[];
  totalCount: number;
  roles: Role[];
  permissions: PermissionMatrix;
  currentUserId: string;
}) {
  const sp = useSearchParams();
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [adding, setAdding] = useState(false);

  const columns: Column<ProfileRow>[] = [
    { key: "username", label: "Username", className: "w-[160px] font-medium" },
    { key: "full_name", label: "Full Name" },
    { key: "email", label: "Email" },
    { key: "role_name", label: "Role", className: "w-[160px]", render: (r) => r.role_name || "—" },
    {
      key: "status", label: "Status", className: "w-[100px]",
      render: (r) => <Badge variant={r.status === "active" ? "success" : "secondary"}>{r.status}</Badge>,
    },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status",
      options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
    { key: "role_id", label: "Role",
      options: roles.map((r) => ({ value: r.id, label: r.name })) },
  ];

  const bulkActions: BulkAction<ProfileRow>[] = [];
  if (can(permissions, "users", "edit")) {
    bulkActions.push({ label: "Set active", icon: CheckCircle2, variant: "outline",
      run: (rows) => bulkSetUserStatus(rows.map((r) => r.id), "active") });
    bulkActions.push({ label: "Set inactive", icon: XCircle, variant: "outline",
      run: (rows) => bulkSetUserStatus(rows.map((r) => r.id), "inactive") });
  }
  if (can(permissions, "users", "delete")) {
    bulkActions.push({ label: "Delete", icon: Trash2, variant: "destructive",
      run: (rows) => bulkDeleteUsers(rows.filter((r) => r.id !== currentUserId).map((r) => r.id)) });
  }

  return (
    <div>
      <PageHeader title="Users" description="System users and assigned roles">
        <ExportButton action={() => exportUsers(
          sp.get("q") || undefined, sp.get("status") || undefined, sp.get("role_id") || undefined,
        )} />
        {can(permissions, "users", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New User
          </Button>
        )}
      </PageHeader>

      <DataTable<ProfileRow>
        columns={columns}
        data={users}
        totalCount={totalCount}
        searchPlaceholder="Search by username, email, name..."
        filters={filters}
        bulkActions={bulkActions}
        rowActions={(row) => (
          <>
            {can(permissions, "users", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "users", "delete") && row.id !== currentUserId && (
              <DeleteButton action={() => deleteUser(row.id)} message="The auth account will be permanently deleted." />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <UserDialog user={editing} roles={roles} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </div>
  );
}

function UserDialog({ user, roles, onClose }: { user: ProfileRow | null; roles: Role[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = user ? await updateUser(user.id, fd) : await createUser(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(user ? "User updated" : "User created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "Edit User" : "New User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-6"><Label htmlFor="username">Username</Label>
            <Input id="username" name="username" defaultValue={user?.username || ""} /></div>
          <div className="col-span-6"><Label htmlFor="full_name">Full Name</Label>
            <Input id="full_name" name="full_name" defaultValue={user?.full_name || ""} /></div>
          <div className="col-span-12"><Label htmlFor="email">Email *</Label>
            <Input id="email" name="email" type="email" defaultValue={user?.email || ""} required readOnly={!!user} /></div>
          <div className="col-span-6"><Label htmlFor="role_id">Role</Label>
            <Select id="role_id" name="role_id" defaultValue={user?.role_id || ""}>
              <option value="">— None —</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
          <div className="col-span-6"><Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={user?.status || "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="col-span-12"><Label htmlFor="password">{user ? "New Password (leave blank to keep)" : "Password *"}</Label>
            <Input id="password" name="password" type="password" minLength={user ? 0 : 6} required={!user} /></div>
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
