"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import { DataTable, type Column, type BulkAction } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";

import type { Role, Profile } from "@/lib/types";
import {
  ACTIONS, ACTION_LABELS, MODULES, MODULE_LABELS, MODULE_DESCRIPTIONS, can,
  actionsForModule, moduleSupportsAction,
  type PermissionMatrix, type Module, type Action,
} from "@/lib/permissions";
import { createRole, updateRole, deleteRole } from "./actions";

export function RolesClient({
  roles, totalCount, users, permissions,
}: {
  roles: Role[];
  totalCount: number;
  users: Profile[];
  permissions: PermissionMatrix;
}) {
  const [editing, setEditing] = useState<Role | null>(null);
  const [adding, setAdding] = useState(false);

  const columns: Column<Role>[] = [
    { key: "name", label: "Role", className: "w-[200px] font-medium" },
    { key: "description", label: "Description" },
    { key: "users", label: "Users", className: "w-[80px]",
      render: (r) => users.filter((u) => u.role_id === r.id).length },
    { key: "is_system", label: "System", className: "w-[100px]",
      render: (r) => r.is_system ? <Badge variant="info">System</Badge> : "" },
  ];

  const bulkActions: BulkAction<Role>[] = [];
  if (can(permissions, "roles", "delete")) {
    bulkActions.push({
      label: "Delete (non-system, unused only)", icon: Trash2, variant: "destructive",
      run: async (rows) => {
        let ok = 0, skip = 0;
        for (const r of rows) {
          if (r.is_system) { skip++; continue; }
          if (users.some((u) => u.role_id === r.id)) { skip++; continue; }
          const result = await deleteRole(r.id);
          if (result.ok) ok++; else skip++;
        }
        return { ok: true, message: `${ok} role(s) deleted${skip ? `, ${skip} skipped` : ""}` };
      },
    });
  }

  return (
    <div>
      <PageHeader title="Roles & Permissions" description="Each module/page is a permission. Grant per-role view, create, edit, delete.">
        {can(permissions, "roles", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Role
          </Button>
        )}
      </PageHeader>

      <DataTable<Role>
        columns={columns}
        data={roles}
        totalCount={totalCount}
        searchPlaceholder="Search roles by name or description..."
        bulkActions={bulkActions}
        rowActions={(row) => (
          <>
            {can(permissions, "roles", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "roles", "delete") && !row.is_system && (
              <DeleteButton action={() => deleteRole(row.id)}
                message="Role is removed only if no users are assigned to it." />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <RoleDialog role={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </div>
  );
}

function RoleDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const initialPerms: PermissionMatrix = (() => {
    const m: PermissionMatrix = {};
    MODULES.forEach((mod) => {
      m[mod] = {} as Record<Action, boolean>;
      actionsForModule(mod).forEach((a) => { m[mod]![a] = Boolean(role?.permissions?.[mod]?.[a]); });
    });
    return m;
  })();
  const [perms, setPerms] = useState<PermissionMatrix>(initialPerms);

  function setCell(mod: Module, action: Action, v: boolean) {
    if (!moduleSupportsAction(mod, action)) return;
    setPerms((p) => ({ ...p, [mod]: { ...(p[mod] || {}), [action]: v } as never }));
  }
  function setAll(v: boolean | "view-only") {
    const next: PermissionMatrix = {};
    MODULES.forEach((mod) => {
      next[mod] = {} as Record<Action, boolean>;
      actionsForModule(mod).forEach((a) => {
        next[mod]![a] = v === "view-only" ? a === "view" : v === true;
      });
    });
    setPerms(next);
  }
  function setRow(mod: Module, v: boolean | "view-only") {
    setPerms((p) => {
      const row = {} as Record<Action, boolean>;
      actionsForModule(mod).forEach((a) => { row[a] = v === "view-only" ? a === "view" : v === true; });
      return { ...p, [mod]: row };
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("permissions", JSON.stringify(perms));
    start(async () => {
      const r = role ? await updateRole(role.id, fd) : await createRole(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(role ? "Role updated" : "Role created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit Role: ${role.name}` : "New Role"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3">
          <div className="col-span-5"><Label htmlFor="name">Role Name *</Label>
            <Input id="name" name="name" defaultValue={role?.name || ""} readOnly={role?.is_system} required />
          </div>
          <div className="col-span-7"><Label htmlFor="description">Description</Label>
            <Input id="description" name="description" defaultValue={role?.description || ""} />
          </div>

          <div className="col-span-12">
            <div className="flex justify-between items-center mb-2">
              <Label>Module Permissions</Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)}>Select all</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)}>Clear all</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setAll("view-only")}>View only</Button>
              </div>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">Module / Resource</th>
                    {ACTIONS.map((a) => <th key={a} className="text-center p-2 w-[72px]">{ACTION_LABELS[a]}</th>)}
                    <th className="text-center p-2 w-[110px]">Quick set</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((mod) => (
                    <tr key={mod} className="border-t align-top">
                      <td className="p-2">
                        <div className="font-medium text-slate-900">{MODULE_LABELS[mod]}</div>
                        <div className="text-[11px] text-slate-500 leading-snug mt-0.5 max-w-[320px]">
                          {MODULE_DESCRIPTIONS[mod]}
                        </div>
                      </td>
                      {ACTIONS.map((a) => (
                        <td key={a} className="p-2 text-center">
                          {moduleSupportsAction(mod, a) ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-blue-600"
                              checked={Boolean(perms[mod]?.[a])}
                              onChange={(e) => setCell(mod, a, e.target.checked)}
                            />
                          ) : (
                            <span className="text-slate-300" title="Not applicable to this module">—</span>
                          )}
                        </td>
                      ))}
                      <td className="p-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <button type="button" onClick={() => setRow(mod, true)}
                            className="text-[10px] uppercase text-blue-600 hover:underline">All</button>
                          <span className="text-slate-300">·</span>
                          <button type="button" onClick={() => setRow(mod, "view-only")}
                            className="text-[10px] uppercase text-slate-600 hover:underline">View</button>
                          <span className="text-slate-300">·</span>
                          <button type="button" onClick={() => setRow(mod, false)}
                            className="text-[10px] uppercase text-slate-500 hover:underline">None</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
