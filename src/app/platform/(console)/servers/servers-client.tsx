"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Server, Plus, Plug, Rocket, Pencil, Trash2, Terminal, CheckCircle2, XCircle, Loader2,
  Wrench, Play,
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
  runServerOperation,
} from "./actions";

export type ServerRow = {
  id: string; name: string; host: string; port: number; ssh_user: string; auth_method: string;
  app_dir: string; repo_url: string | null; branch: string | null; app_port: number;
  base_url: string | null; domain: string | null; subdomain: string | null; base_domain: string | null; ssl_email: string | null;
  setup_ssl: boolean; www_alias: boolean;
  status: string; last_checked: string | null; last_result: string | null;
};
export type DeploymentRow = {
  id: string; server_name: string | null; tenant_name: string | null; status: string;
  app_port: number | null; base_url: string | null; started_at: string; finished_at: string | null;
};

const STATUS_BADGE: Record<string, "success" | "danger" | "secondary" | "warning"> = {
  online: "success", offline: "secondary", error: "danger", unknown: "secondary",
  running: "warning", success: "success", failed: "danger",
};

export function ServersClient({
  servers, deployments, openDeploy,
}: {
  servers: ServerRow[]; deployments: DeploymentRow[]; openDeploy?: boolean;
}) {
  const [editing, setEditing] = useState<ServerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [deploy, setDeploy] = useState<{ server?: ServerRow } | null>(openDeploy ? {} : null);
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
                  {srv.domain && (
                    <p className="text-xs text-slate-600 mt-0.5">
                      🌐 {srv.domain} {srv.setup_ssl && <Badge variant="success">HTTPS</Badge>}
                    </p>
                  )}
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
                <OperationsButton id={srv.id} name={srv.name} />
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
        <DeployDialog servers={servers} preset={deploy} onClose={() => setDeploy(null)} />
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

type Op = { key: string; label: string; desc: string; cat: string; danger?: boolean; confirm?: string };

const OPS: Op[] = [
  // App / pm2
  { key: "app_status",  label: "App status",       desc: "pm2 process list & uptime",           cat: "Application" },
  { key: "app_health",  label: "Health check",     desc: "Is the app answering on its port?",    cat: "Application" },
  { key: "app_logs",    label: "App logs",         desc: "Recent stdout + error output",         cat: "Application" },
  { key: "app_restart", label: "Restart app",      desc: "pm2 restart + save",                   cat: "Application" },
  { key: "app_start",   label: "Start app",        desc: "Start stopped processes",              cat: "Application" },
  { key: "app_stop",    label: "Stop app",         desc: "pm2 stop all", cat: "Application", danger: true, confirm: "Stop the app (site goes offline)?" },
  // Web server
  { key: "nginx_status",  label: "nginx status",   desc: "Active state + config test",           cat: "Web server" },
  { key: "nginx_reload",  label: "Reload nginx",   desc: "Graceful config reload",               cat: "Web server" },
  { key: "nginx_restart", label: "Restart nginx",  desc: "Full nginx restart",                   cat: "Web server" },
  { key: "nginx_logs",    label: "nginx error log",desc: "Last 80 lines",                        cat: "Web server" },
  { key: "free_ports",    label: "Free ports 80/443", desc: "Kill stray processes, restart nginx", cat: "Web server", danger: true, confirm: "Force-free ports 80/443 and restart nginx?" },
  // SSL
  { key: "ssl_info",   label: "Certificate info",  desc: "certbot certificates & expiry",        cat: "SSL" },
  { key: "ssl_renew",  label: "Renew certificate", desc: "Run certbot renew",                    cat: "SSL" },
  // App maintenance (fix without re-uploading)
  { key: "app_reinstall", label: "Reinstall dependencies", desc: "Refresh npm + clean reinstall node_modules (fixes broken installs)", cat: "Maintenance" },
  { key: "app_rebuild",   label: "Rebuild & restart",      desc: "npm run build, then restart the app",                              cat: "Maintenance" },
  { key: "npm_update",    label: "Update npm",             desc: "Update npm to latest (fixes the 'Exit handler' bug)",              cat: "Maintenance" },
  // System
  { key: "sys_resources", label: "Resources",      desc: "CPU load, RAM, disk, swap, top procs", cat: "System" },
  { key: "create_swap",   label: "Add swap (2G)",  desc: "Swap file for low-RAM servers",        cat: "System" },
  { key: "restart_all",   label: "Restart all",    desc: "App + nginx",                          cat: "System" },
  { key: "sys_update",    label: "Update OS packages", desc: "apt/dnf upgrade (can be slow)",    cat: "System", danger: true, confirm: "Update all OS packages now? This can take a while." },
  { key: "reboot",        label: "Reboot server",  desc: "Full server reboot",                   cat: "System", danger: true, confirm: "Reboot the entire server now?" },
];

const OP_CATS = ["Application", "Maintenance", "Web server", "SSL", "System"];

function OperationsButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Wrench className="h-3.5 w-3.5" /> Operations
      </Button>
      {open && <OperationsModal id={id} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function OperationsModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("");
  const [output, setOutput] = useState<string>("");

  function run(op: Op) {
    if (op.confirm && !confirm(op.confirm)) return;
    setRunning(op.key);
    setTitle(op.label);
    setOutput("Running…");
    start(async () => {
      const r = await runServerOperation(id, op.key);
      setOutput(r.ok ? (r.info || "Done.") : (r.error || "Failed"));
      setRunning(null);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Operations — {name}</DialogTitle></DialogHeader>
        <div className="grid md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-4">
            {OP_CATS.map((cat) => (
              <div key={cat}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{cat}</p>
                <div className="space-y-1">
                  {OPS.filter((o) => o.cat === cat).map((op) => (
                    <button
                      key={op.key}
                      onClick={() => run(op)}
                      disabled={pending}
                      className={`w-full text-left rounded-lg border px-3 py-2 flex items-center justify-between gap-2 transition-colors disabled:opacity-50 ${
                        op.danger ? "hover:bg-red-50 border-red-100" : "hover:bg-slate-50"
                      }`}
                    >
                      <span>
                        <span className={`text-sm font-medium ${op.danger ? "text-red-700" : "text-slate-800"}`}>{op.label}</span>
                        <span className="block text-[11px] text-slate-500">{op.desc}</span>
                      </span>
                      {running === op.key ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Play className="h-3.5 w-3.5 text-slate-400" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
              {title ? `Output — ${title}` : "Output"}
            </p>
            <pre className="text-[11px] bg-slate-950 text-slate-100 rounded-lg p-3 h-[60vh] overflow-auto whitespace-pre-wrap font-mono">
              {output || "Pick an operation on the left to run it here."}
            </pre>
          </div>
        </div>
        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [sub, setSub] = useState(server?.subdomain ?? "");
  const [base, setBase] = useState(server?.base_domain ?? server?.domain ?? "");
  const fullHost = base.trim() ? (sub.trim() ? `${sub.trim()}.${base.trim()}` : base.trim()) : "";

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
          <div className="col-span-8"><Label htmlFor="repo_url">Git repo URL (optional)</Label><Input id="repo_url" name="repo_url" defaultValue={server?.repo_url ?? ""} placeholder="leave blank to upload this app folder" /></div>
          <div className="col-span-4"><Label htmlFor="branch">Branch</Label><Input id="branch" name="branch" defaultValue={server?.branch ?? "main"} /></div>
          <p className="col-span-12 -mt-1 text-[11px] text-slate-500">Leave the repo URL blank to upload this console&apos;s app files directly (best for a fresh server with no git).</p>
          <div className="col-span-12 pt-1 border-t mt-1"><span className="text-xs font-semibold text-slate-500">Domain &amp; HTTPS (optional)</span></div>
          <div className="col-span-4"><Label htmlFor="subdomain">Subdomain</Label>
            <Input id="subdomain" name="subdomain" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="mombasa" /></div>
          <div className="col-span-8"><Label htmlFor="base_domain">Base domain</Label>
            <Input id="base_domain" name="base_domain" value={base} onChange={(e) => setBase(e.target.value)} placeholder="inventorypro.shop" /></div>
          <div className="col-span-12 -mt-1">
            {fullHost
              ? <p className="text-[11px] text-slate-600">Site will be served at <b className="font-mono">https://{fullHost}</b></p>
              : <p className="text-[11px] text-slate-400">Leave blank to serve on the server IP + port only. Add a subdomain to host this shop at e.g. <span className="font-mono">mombasa.inventorypro.shop</span>.</p>}
          </div>
          <div className="col-span-12"><Label htmlFor="ssl_email">SSL email</Label><Input id="ssl_email" name="ssl_email" type="email" defaultValue={server?.ssl_email ?? ""} placeholder="you@example.com" /></div>
          <label className="col-span-6 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="setup_ssl" defaultChecked={server ? server.setup_ssl : true} /> Issue HTTPS (Let&apos;s Encrypt)
          </label>
          <label className="col-span-6 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="www_alias" defaultChecked={server ? server.www_alias : false} /> Also serve www.
          </label>
          <p className="col-span-12 -mt-1 text-[11px] text-slate-500">
            DNS: point an <b>A record</b> for <span className="font-mono">{fullHost || "this host"}</span> to the server IP —
            or set a <b>wildcard</b> <span className="font-mono">*.{base.trim() || "yourdomain.com"}</span> → server IP once,
            and every subdomain just works. Each subdomain still gets its own free SSL certificate automatically.
          </p>
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
  servers, preset, onClose,
}: {
  servers: ServerRow[];
  preset: { server?: ServerRow }; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [serverId, setServerId] = useState(preset.server?.id || "");
  const [port, setPort] = useState<string>(String(preset.server?.app_port || 3000));
  const [source, setSource] = useState<"upload" | "repo">("upload");
  const [folder, setFolder] = useState("");
  const [deploymentId, setDeploymentId] = useState<string | null>(null);

  const selectedServer = servers.find((s) => s.id === serverId);
  const hasRepo = !!selectedServer?.repo_url;

  function launch() {
    if (!serverId) { setError("Choose a server."); return; }
    setError(null);
    start(async () => {
      const r = await startDeployment(serverId, Number(port) || undefined, source, folder.trim() || undefined);
      if (!r.ok || !r.deploymentId) { setError(r.error || "Failed to start."); return; }
      setDeploymentId(r.deploymentId);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5" /> Deploy app</DialogTitle></DialogHeader>
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
            <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
              This deploys a <b>clean</b> app. When it&apos;s live, open the site and the <b>first screen is Install</b>,
              where you enter the shop name to create it. No shop is pre-selected here — so there&apos;s no chance of
              re-using an already-installed inventory.
            </div>
            <div className="flex gap-3">
              <div className="w-40">
                <Label htmlFor="prt">App port</Label>
                <Input id="prt" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <div className="flex-1">
                <Label htmlFor="src">Deploy source</Label>
                <Select id="src" value={source} onChange={(e) => setSource(e.target.value as "upload" | "repo")}>
                  <option value="upload">Upload an app folder (recommended)</option>
                  <option value="repo" disabled={!hasRepo}>
                    Git repository{hasRepo ? "" : " — none configured on server"}
                  </option>
                </Select>
              </div>
            </div>
            {source === "upload" && (
              <div>
                <Label htmlFor="folder">Source folder (on the console host)</Label>
                <Input id="folder" value={folder} onChange={(e) => setFolder(e.target.value)}
                  placeholder="Leave blank to use this console's own app folder" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Absolute path to the app folder to upload, e.g. <span className="font-mono">C:\Users\HMJ\Desktop\Claude\Sofa</span>.
                  Must contain <span className="font-mono">package.json</span>; <span className="font-mono">node_modules</span>/<span className="font-mono">.next</span> are skipped.
                </p>
              </div>
            )}
            <div className="text-xs bg-slate-50 border rounded-lg px-3 py-2 text-slate-600 space-y-1">
              <p>This will, on the target server:</p>
              <ol className="list-decimal pl-4">
                <li>Install Node.js, git, pm2 &amp; build tools if missing (bare servers supported)</li>
                <li>{source === "repo" && hasRepo
                  ? "Pull the configured git repo"
                  : "Upload this console's app folder over SFTP (no git needed)"}</li>
                <li>Build &amp; start the app with pm2 (auto-restarts on reboot)</li>
                {selectedServer?.domain && (
                  <li>Configure nginx for <b>{selectedServer.domain}</b>{selectedServer.setup_ssl ? " and issue a free HTTPS certificate" : ""}</li>
                )}
              </ol>
              <p>Supabase credentials come from this console&apos;s environment.</p>
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
