"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserCog, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { setTenantUserStatus, resetTenantUserPassword, changeTenantUserRole } from "./user-actions";

export type TUser = {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  status: string | null;
  roleName: string | null;
  role_id: string | null;
};

export type TRole = { id: string; name: string };

export function TenantUsers({
  tenantId, users, roles,
}: { tenantId: string; users: TUser[]; roles: TRole[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pwUser, setPwUser] = useState<TUser | null>(null);
  const [roleUser, setRoleUser] = useState<TUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleStatus(u: TUser) {
    const next = u.status === "active" ? "inactive" : "active";
    if (!confirm(`${next === "inactive" ? "Deactivate" : "Activate"} ${u.full_name || u.email}?`)) return;
    setError(null);
    start(async () => {
      const r = await setTenantUserStatus(tenantId, u.id, next);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      router.refresh();
    });
  }

  return (
    <div>
      {error && <div className="mx-4 mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="w-[130px]">Role</TableHead>
            <TableHead className="w-[90px]">Status</TableHead>
            <TableHead className="w-[150px] text-right">Manage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center text-slate-500 p-6">No users.</TableCell></TableRow>
          ) : users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium text-slate-800">{u.full_name || u.username || "—"}</TableCell>
              <TableCell className="text-sm text-slate-600">{u.email || "—"}</TableCell>
              <TableCell>{u.roleName ? <Badge variant="info">{u.roleName}</Badge> : <span className="text-xs text-slate-400">none</span>}</TableCell>
              <TableCell><Badge variant={u.status === "active" ? "success" : "secondary"}>{u.status || "—"}</Badge></TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button variant="ghost" size="icon" title="Reset password" disabled={pending} onClick={() => setPwUser(u)}>
                  <KeyRound className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Change role" disabled={pending} onClick={() => setRoleUser(u)}>
                  <UserCog className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title={u.status === "active" ? "Deactivate" : "Activate"} disabled={pending} onClick={() => toggleStatus(u)}>
                  <Power className={`h-4 w-4 ${u.status === "active" ? "text-red-600" : "text-emerald-600"}`} />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pwUser && <PasswordDialog tenantId={tenantId} user={pwUser} onClose={() => setPwUser(null)} />}
      {roleUser && <RoleDialog tenantId={tenantId} user={roleUser} roles={roles} onClose={() => setRoleUser(null)} />}
    </div>
  );
}

function PasswordDialog({ tenantId, user, onClose }: { tenantId: string; user: TUser; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function save() {
    setError(null);
    start(async () => {
      const r = await resetTenantUserPassword(tenantId, user.id, pw);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      setDone(true);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset password — {user.full_name || user.email}</DialogTitle></DialogHeader>
        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700">Password updated. Share the new password securely with the user.</p>
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
            <div>
              <Label htmlFor="np">New password</Label>
              <Input id="np" type="text" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} placeholder="At least 8 characters" autoComplete="off" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={save} disabled={pending || pw.length < 8}>{pending ? "Saving…" : "Set password"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ tenantId, user, roles, onClose }: { tenantId: string; user: TUser; roles: TRole[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [roleId, setRoleId] = useState(user.role_id || "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const r = await changeTenantUserRole(tenantId, user.id, roleId);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change role — {user.full_name || user.email}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
          <div>
            <Label htmlFor="rl">Role</Label>
            <Select id="rl" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">— Select role —</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || !roleId}>{pending ? "Saving…" : "Save role"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
