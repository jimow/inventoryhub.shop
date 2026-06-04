"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Lock, Eye, Play, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TENANT_STATUS_META, type TenantStatus } from "@/lib/platform-shared";
import { changeTenantStatus, updateTenantNotes, updateWorkspace, deleteWorkspace } from "../actions";

const STATUSES: TenantStatus[] = ["active", "read_only", "suspended", "locked"];

const QUICK: { status: TenantStatus; icon: React.ElementType; variant: "outline" | "destructive" }[] = [
  { status: "read_only", icon: Eye, variant: "outline" },
  { status: "suspended", icon: Pause, variant: "outline" },
  { status: "locked", icon: Lock, variant: "destructive" },
];

export function ManagePanel({
  tenantId, name, status, reason, notes,
}: {
  tenantId: string;
  name: string;
  status: TenantStatus;
  reason: string | null;
  notes: string | null;
}) {
  const router = useRouter();
  const [dialogStatus, setDialogStatus] = useState<TenantStatus | null>(null);
  const meta = TENANT_STATUS_META[status];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Current status</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={meta.badge}>{meta.label}</Badge>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 max-w-sm">{meta.description}</p>
          {reason && <p className="mt-1 text-xs text-slate-600">Reason: {reason}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {status !== "active" && (
          <Button size="sm" variant="default" onClick={() => setDialogStatus("active")}>
            <Play className="h-3.5 w-3.5" /> Reactivate
          </Button>
        )}
        {QUICK.filter((q) => q.status !== status).map((q) => {
          const Icon = q.icon;
          return (
            <Button key={q.status} size="sm" variant={q.variant} onClick={() => setDialogStatus(q.status)}>
              <Icon className="h-3.5 w-3.5" /> {TENANT_STATUS_META[q.status].label}
            </Button>
          );
        })}
      </div>

      <NotesEditor tenantId={tenantId} initial={notes} onSaved={() => router.refresh()} />

      {dialogStatus && (
        <ConfirmStatusDialog
          tenantId={tenantId}
          name={name}
          target={dialogStatus}
          currentReason={reason}
          onClose={() => setDialogStatus(null)}
          onDone={() => { setDialogStatus(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ConfirmStatusDialog({
  tenantId, name, target, currentReason, onClose, onDone,
}: {
  tenantId: string;
  name: string;
  target: TenantStatus;
  currentReason: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState(target === "active" ? "" : currentReason || "");
  const [status, setStatus] = useState<TenantStatus>(target);
  const [error, setError] = useState<string | null>(null);
  const meta = TENANT_STATUS_META[status];

  function apply() {
    setError(null);
    start(async () => {
      const r = await changeTenantStatus(tenantId, status, reason);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update “{name}”</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <Label htmlFor="st">Set status to</Label>
            <Select id="st" value={status} onChange={(e) => setStatus(e.target.value as TenantStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{TENANT_STATUS_META[s].label}</option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-slate-500">{meta.description}</p>
          </div>
          <div>
            <Label htmlFor="rsn">Reason / note</Label>
            <Textarea id="rsn" value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Shown to users when access is restricted." />
          </div>
          {meta.blocks && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              Users will immediately lose access and see this notice.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={apply} disabled={pending}>{pending ? "Saving…" : "Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceAdmin({
  tenantId, name, slug, plan,
}: { tenantId: string; name: string; slug: string | null; plan: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Pencil className="h-3.5 w-3.5" /> Edit details
      </Button>

      <div className="pt-3 border-t">
        <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Danger zone</p>
        <p className="text-xs text-slate-500 mt-1 mb-2">
          Permanently delete this workspace and every record it holds. This cannot be undone.
        </p>
        <Button size="sm" variant="destructive" onClick={() => setDeleting(true)}>
          <Trash2 className="h-3.5 w-3.5" /> Delete workspace
        </Button>
      </div>

      {editing && (
        <EditDialog tenantId={tenantId} name={name} slug={slug} plan={plan}
          onClose={() => setEditing(false)} onDone={() => { setEditing(false); router.refresh(); }} />
      )}
      {deleting && (
        <DeleteDialog tenantId={tenantId} name={name}
          onClose={() => setDeleting(false)} />
      )}
    </div>
  );
}

function EditDialog({
  tenantId, name, slug, plan, onClose, onDone,
}: {
  tenantId: string; name: string; slug: string | null; plan: string | null;
  onClose: () => void; onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [vName, setVName] = useState(name);
  const [vSlug, setVSlug] = useState(slug || "");
  const [vPlan, setVPlan] = useState(plan || "");

  function save() {
    setError(null);
    start(async () => {
      const r = await updateWorkspace(tenantId, { name: vName, slug: vSlug, plan: vPlan });
      if (!r.ok) { setError(r.error || "Failed."); return; }
      onDone();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit workspace</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
          <div><Label htmlFor="wname">Name</Label><Input id="wname" value={vName} onChange={(e) => setVName(e.target.value)} /></div>
          <div><Label htmlFor="wslug">Slug</Label><Input id="wslug" value={vSlug} onChange={(e) => setVSlug(e.target.value)} placeholder="shop_mombasa" /></div>
          <div><Label htmlFor="wplan">Plan</Label><Input id="wplan" value={vPlan} onChange={(e) => setVPlan(e.target.value)} placeholder="e.g. Free / Pro" /></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ tenantId, name, onClose }: { tenantId: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  function run() {
    setError(null);
    start(async () => {
      const r = await deleteWorkspace(tenantId, confirm);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      router.push("/platform/tenants");
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="text-red-700">Delete “{name}”</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
          <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
            This permanently deletes the workspace and <b>all</b> of its data — products, sales, purchases,
            customers, accounts, users and history. This cannot be undone.
          </div>
          <div>
            <Label htmlFor="confirm">Type the workspace name to confirm</Label>
            <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={name} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={run} disabled={pending || confirm.trim() !== name}>
            {pending ? "Deleting…" : "Delete forever"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotesEditor({
  tenantId, initial, onSaved,
}: { tenantId: string; initial: string | null; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState(initial || "");
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(false);
    start(async () => {
      const r = await updateTenantNotes(tenantId, notes);
      if (r.ok) { setSaved(true); onSaved(); }
    });
  }

  return (
    <div className="pt-2 border-t">
      <Label htmlFor="notes">Internal notes</Label>
      <Textarea id="notes" value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
        rows={2} placeholder="Private notes about this workspace (not shown to users)." />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save notes"}
        </Button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}
