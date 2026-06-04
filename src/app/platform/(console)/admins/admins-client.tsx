"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Trash2, Plus, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { addPlatformAdmin, removePlatformAdmin } from "./actions";

export type AdminRow = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
};

export function AdminsClient({
  admins, currentUserId,
}: { admins: AdminRow[]; currentUserId: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(id: string) {
    if (!confirm("Revoke platform admin access for this account?")) return;
    setError(null);
    start(async () => {
      const r = await removePlatformAdmin(id);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Platform Administrators</h1>
          <p className="text-sm text-slate-500">People with super-admin access to every workspace.</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add admin</Button>
      </div>

      {error && (
        <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Administrator</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-[120px]">Added</TableHead>
              <TableHead className="w-[100px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-slate-800">{a.name || a.email || "Administrator"}</span>
                    {a.id === currentUserId && <Badge variant="info">You</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-slate-600">{a.email || "—"}</TableCell>
                <TableCell className="text-sm text-slate-500">{formatDate(a.created_at)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Revoke" disabled={pending} onClick={() => remove(a.id)}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {adding && <AddDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await addPlatformAdmin(fd);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> Add platform administrator</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" placeholder="e.g. Operations Lead" />
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" />
            <p className="mt-1 text-xs text-slate-500">
              Leave blank to promote an existing login. Set a password to create a brand-new super-admin account.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add admin"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
