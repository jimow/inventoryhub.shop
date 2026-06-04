"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Server, Plus, Plug, Rocket, Pencil, Trash2, Terminal, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";
import {
  saveServer, deleteServer, testServerConnection, startDeployment, getDeployment,
} from "./actions";

export type ServerRow = {
  id: string; name: string; host: string; port: number; ssh_user: string; auth_method: string;
  app_dir: string; repo_url: string | null; branch: string | null; app_port: number;
  base_url: string | null; status: string; last_checked: string | null; last_result: string | null;
};
export type DeploymentRow = {
  id: string; server_name: string | null; tenant_name: string | null; status: string;
  app_port: number | null; base_url: string | null; started_at: string; finished_at: string | null;
};
type Tenant = { id: string; name: string };

const STATUS_BADGE: Record<string, "success" | "danger" | "secondary" | "warning"> = {
  online: "success", offline: "secondary", error: "danger", unknown: "secondary",
  running: "warning", success: "success", failed: "danger",
};

export function ServersClient({
  servers, deployments, tenants, deployTenantId,
}: {
  servers: ServerRow[]; deployments: DeploymentRow[]; tenants: Tenant[]; deployTenantId: string | null;
}) {
  const [editing, setEditing] = useState<ServerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [deploy, setDeploy] = useState<{ server?: ServerRow; tenantId?: string } | null>(
    deployTenantId ? { tenantId: deployTenantId } : null
  );
  const [viewLog, setViewLog] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Servers &amp; Deployment</h1>
          <p className="text-sm text-slate-500">Register remote machines and deploy a workspace to them over SSH.</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add server</Button>
      </div>

      {servers.length === 0 ? (
        <Card className="p-10 text-center text-slate-500">
          <Server className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          No servers yet. Add one to deploy a workspace remotely.
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {servers.map((srv) => (
            <Card key={srv.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-slate-500" />
                    <h3 className="font-semibold text-slate-900 truncate">{srv.name}</h3>
                    <Badge variant={STATUS_BADGE[srv.status] || "secondary"}>{srv.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    {srv.ssh_user}@{srv.host}:{srv.port} · {srv.app_dir}
                  </p>
                  {srv.base_url && (
                    <a href={srv.base_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">{srv.base_url}</a>
                  )}
                </div>
              </div>

              {srv.last_result && (
                <pre className="mt-3 text-[11px] bg-slate-50 border rounded-lg p-2 text-slate-600 whitespace-pre-wrap max-h-24 overflow-auto">{srv.last_result}</pre>
              )}
              {srv.last_checked && <p className="mt-1 text-[11px] text-slate-400">Checked {formatDateTime(srv.last_checked)}</p>}

              <div className="mt-4 flex flex-wrap gap-2">
                <TestButton id={srv.id} />
                <Button size="sm" onClick={() => setDeploy({ server: srv })}><Rocket className="h-3.5 w-3.5" /> Deploy</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(srv)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                <DeleteServerButton id={srv.id} name={srv.name} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Recent deployments */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b"><h2 className="text-sm font-semibold text-slate-800">Recent deployments</h2></div>
        <div className="divide-y">
          {deployments.length === 0 && <div className="p-6 text-sm text-slate-400 text-center">No deployments yet.</div>}
          {deployments.map((d) => (
            <div key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-800 truncate">
                  <span className="font-medium">{d.tenant_name}</span> → {d.server_name}
                  {d.app_port ? <span className="text-slate-400"> :{d.app_port}</span> : null}
                </p>
                <p className="text-[11px] text-slate-400">
                  {formatDateTime(d.started_at)}{d.finished_at ? ` · finished ${formatDateTime(d.finished_at)}` : " · running"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_BADGE[d.status] || "secondary"}>{d.status}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setViewLog(d.id)}><Terminal className="h-3.5 w-3.5" /> Log</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {(adding || editing) && (
        <ServerDialog server={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      {deploy && (
        <DeployDialog servers={servers} tenants={tenants} preset={deploy} onClose={() => setDeploy(null)} />
      )}
      {viewLog && <LogModal deploymentId={viewLog} onClose={() => setViewLog(null)} />}
    </div>
  );
}

function TestButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; msg: string } | null>(null);
  function run() {
    setRes(null);
    start(async () => {
      const r = await testServerConnection(id);
      setRes({ ok: r.ok, msg: r.ok ? (r.info || "Reachable") : (r.error || "Failed") });
    });
  }
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={pending} title={res?.msg}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Test
      {res && (res.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />)}
    </Button>
  );
}

function DeleteServerButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run() {
    if (!confirm(`Remove server “${name}”? Deployments already made are not affected.`)) return;
    start(async () => { await deleteServer(id); router.refresh(); });
  }
  return (
    <Button size="sm" variant="ghost" onClick={run} disabled={pending} title="Remove">
      <Trash2 className="h-3.5 w-3.5 text-red-600" />
    </Button>
  );
}

function ServerDialog({ server, onClose }: { server: ServerRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState(server?.auth_method || "key");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await saveServer(fd, server?.id);
      if (!r.ok) { setError(r.error || "Failed."); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{server ? "Edit server" : "Add server"}</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-12 gap-3 max-h-[70vh] overflow-y-auto pr-1">
          {error && <div className="col-span-12 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
          <div className="col-span-12"><Label htmlFor="name">Name *</Label><Input id="name" name="name" defaultValue={server?.name} required placeholder="e.g. Mombasa VPS" /></div>
          <div className="col-span-8"><Label htmlFor="host">Host / IP *</Label><Input id="host" name="host" defaultValue={server?.host} required placeholder="203.0.113.10" /></div>
          <div className="col-span-4"><Label htmlFor="port">SSH port</Label><Input id="port" name="port" type="number" defaultValue={server?.port ?? 22} /></div>
          <div className="col-span-6"><Label htmlFor="ssh_user">SSH user</Label><Input id="ssh_user" name="ssh_user" defaultValue={server?.ssh_user ?? "root"} /></div>
          <div className="col-span-6"><Label htmlFor="auth_method">Auth method</Label>
            <Select id="auth_method" name="auth_method" value={authMethod} onChange={(e) => setAuthMethod(e.target.value)}>
              <option value="key">Private key</option>
              <option value="password">Password</option>
            </Select>
          </div>
          <div className="col-span-12">
            <Label htmlFor="secret">{authMethod === "password" ? "SSH password" : "SSH private key"} {server ? "(leave blank to keep)" : "*"}</Label>
            {authMethod === "password"
              ? <Input id="secret" name="secret" type="password" autoComplete="off" />
              : <Textarea id="secret" name="secret" rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className="font-mono text-xs" />}
            <p className="mt-1 text-[11px] text-slate-500">Stored encrypted (AES-256-GCM). Never shown again.</p>
          </div>
          <div className="col-span-12 pt-1 border-t mt-1"><span className="text-xs font-semibold text-slate-500">Application</span></div>
          <div className="col-span-7"><Label htmlFor="app_dir">App directory</Label><Input id="app_dir" name="app_dir" defaultValue={server?.app_dir ?? "/opt/inventory"} /></div>
          <div className="col-span-5"><Label htmlFor="app_port">App port</Label><Input id="app_port" name="app_port" type="number" defaultValue={server?.app_port ?? 3000} /></div>
          <div className="col-span-8"><Label htmlFor="repo_url">Git repo URL (optional)</Label><Input id="repo_url" name="repo_url" defaultValue={server?.repo_url ?? ""} placeholder="https://github.com/you/inventory.git" /></div>
          <div className="col-span-4"><Label htmlFor="branch">Branch</Label><Input id="branch" name="branch" defaultValue={server?.branch ?? "main"} /></div>
          <div className="col-span-12"><Label htmlFor="base_url">Public URL (optional)</Label><Input id="base_url" name="base_url" defaultValue={server?.base_url ?? ""} placeholder="https://shop.example.com" /></div>
          <div className="col-span-12">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save server"}</Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeployDialog({
  servers, tenants, preset, onClose,
}: {
  servers: ServerRow[]; tenants: Tenant[];
  preset: { server?: ServerRow; tenantId?: string }; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [serverId, setServerId] = useState(preset.server?.id || "");
  const [tenantId, setTenantId] = useState(preset.tenantId || "");
  const [port, setPort] = useState<string>(String(preset.server?.app_port || 3000));
  const [deploymentId, setDeploymentId] = useState<string | null>(null);

  function launch() {
    if (!serverId || !tenantId) { setError("Choose both a server and a workspace."); return; }
    setError(null);
    start(async () => {
      const r = await startDeployment(serverId, tenantId, Number(port) || undefined);
      if (!r.ok || !r.deploymentId) { setError(r.error || "Failed to start."); return; }
      setDeploymentId(r.deploymentId);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" /> Deploy workspace</DialogTitle></DialogHeader>
        {deploymentId ? (
          <DeployProgress deploymentId={deploymentId} onClose={onClose} />
        ) : (
          <div className="space-y-3">
            {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
            <div>
              <Label htmlFor="srv">Server</Label>
              <Select id="srv" value={serverId} onChange={(e) => {
                setServerId(e.target.value);
                const s = servers.find((x) => x.id === e.target.value);
                if (s) setPort(String(s.app_port));
              }}>
                <option value="">— Select server —</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="tnt">Workspace</Label>
              <Select id="tnt" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">— Select workspace —</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div className="w-40">
              <Label htmlFor="prt">App port</Label>
              <Input id="prt" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <div className="text-xs bg-slate-50 border rounded-lg px-3 py-2 text-slate-600">
              The app will be installed, built and started with pm2 on the target server, pinned to this workspace.
              Supabase credentials are taken from this console&apos;s environment.
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button type="button" onClick={launch} disabled={pending}>{pending ? "Starting…" : "Start deployment"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeployProgress({ deploymentId, onClose }: { deploymentId: string; onClose: () => void }) {
  const [state, setState] = useState<{ status: string; log: string; base_url: string | null } | null>(null);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const s = await getDeployment(deploymentId);
      if (!active || !s) return;
      setState({ status: s.status, log: s.log, base_url: s.base_url });
      if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
      if (s.status === "running") setTimeout(poll, 2000);
    };
    poll();
    return () => { active = false; };
  }, [deploymentId]);

  const running = !state || state.status === "running";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {running ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          : state?.status === "success" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          : <XCircle className="h-4 w-4 text-red-600" />}
        <span className="font-medium">
          {running ? "Deploying…" : state?.status === "success" ? "Deployment succeeded" : "Deployment failed"}
        </span>
      </div>
      <pre ref={boxRef} className="text-[11px] bg-slate-950 text-slate-100 rounded-lg p-3 h-72 overflow-auto whitespace-pre-wrap font-mono">
        {state?.log || "Starting…"}
      </pre>
      {state?.base_url && !running && (
        <a href={state.base_url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open {state.base_url} →</a>
      )}
      <DialogFooter>
        <Button type="button" onClick={onClose}>{running ? "Run in background" : "Close"}</Button>
      </DialogFooter>
    </div>
  );
}

function LogModal({ deploymentId, onClose }: { deploymentId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Deployment log</DialogTitle></DialogHeader>
        <DeployProgress deploymentId={deploymentId} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
