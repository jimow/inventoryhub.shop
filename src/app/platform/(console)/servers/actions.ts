"use server";

import { revalidatePath } from "next/cache";
import { createPlatformClient, getPlatformSession, logPlatformAction } from "@/lib/platform";
import { encryptSecret } from "@/lib/crypto";
import { testServer, runDeploy, type DeployConfig, type ServerConn } from "@/lib/ssh";

export type ActionResult = { ok: boolean; error?: string };
export type TestResult = ActionResult & { info?: string };
export type DeployStart = ActionResult & { deploymentId?: string };

function s(formData: FormData, k: string): string {
  return String(formData.get(k) || "").trim();
}

/** Create or update a remote server. SSH secret is encrypted before storage. */
export async function saveServer(formData: FormData, id?: string): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const name = s(formData, "name");
  const host = s(formData, "host");
  if (!name || !host) return { ok: false, error: "Name and host are required." };

  const patch: Record<string, unknown> = {
    name,
    host,
    port: Number(s(formData, "port")) || 22,
    ssh_user: s(formData, "ssh_user") || "root",
    auth_method: s(formData, "auth_method") === "password" ? "password" : "key",
    app_dir: s(formData, "app_dir") || "/opt/inventory",
    repo_url: s(formData, "repo_url") || null,
    branch: s(formData, "branch") || "main",
    app_port: Number(s(formData, "app_port")) || 3000,
    base_url: s(formData, "base_url") || null,
  };
  const secret = String(formData.get("secret") || "");
  if (secret) patch.secret_cipher = encryptSecret(secret);

  const admin = createPlatformClient();
  if (id) {
    const { error } = await admin.from("platform_servers").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    if (!secret) return { ok: false, error: "An SSH private key or password is required." };
    patch.created_by = session.userId;
    const { error } = await admin.from("platform_servers").insert(patch);
    if (error) return { ok: false, error: error.message };
  }

  await logPlatformAction({ action: id ? "server.updated" : "server.added", detail: { name, host } });
  revalidatePath("/platform/servers");
  return { ok: true };
}

export async function deleteServer(id: string): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };
  const admin = createPlatformClient();
  const { data: srv } = await admin.from("platform_servers").select("name").eq("id", id).maybeSingle();
  const { error } = await admin.from("platform_servers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logPlatformAction({ action: "server.removed", detail: { name: srv?.name ?? null } });
  revalidatePath("/platform/servers");
  return { ok: true };
}

/** Probe a server over SSH and record the result. */
export async function testServerConnection(id: string): Promise<TestResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };
  const admin = createPlatformClient();
  const { data: server } = await admin.from("platform_servers").select("*").eq("id", id).maybeSingle();
  if (!server) return { ok: false, error: "Server not found." };

  const conn: ServerConn = {
    host: server.host, port: server.port, ssh_user: server.ssh_user,
    auth_method: server.auth_method, secret_cipher: server.secret_cipher,
  };
  const result = await testServer(conn);
  await admin.from("platform_servers").update({
    status: result.ok ? "online" : "error",
    last_checked: new Date().toISOString(),
    last_result: result.ok ? (result.info || "Reachable") : (result.error || "Unreachable"),
  }).eq("id", id);
  revalidatePath("/platform/servers");
  return result.ok ? { ok: true, info: result.info } : { ok: false, error: result.error };
}

/** Kick off a deployment of a workspace to a server. Runs asynchronously. */
export async function startDeployment(
  serverId: string,
  tenantId: string,
  appPortOverride?: number
): Promise<DeployStart> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const admin = createPlatformClient();
  const { data: server } = await admin.from("platform_servers").select("*").eq("id", serverId).maybeSingle();
  if (!server) return { ok: false, error: "Server not found." };
  const { data: tenant } = await admin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle();
  if (!tenant) return { ok: false, error: "Workspace not found." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return { ok: false, error: "This server is missing Supabase environment variables." };

  const appPort = appPortOverride || server.app_port || 3000;

  const { data: dep, error: insErr } = await admin.from("platform_deployments").insert({
    server_id: serverId, server_name: server.name,
    tenant_id: tenantId, tenant_name: tenant.name,
    status: "running", step: "starting", app_port: appPort, created_by: session.userId,
  }).select("id").single();
  if (insErr || !dep) return { ok: false, error: insErr?.message || "Could not create deployment." };
  const depId = dep.id as string;

  const cfg: DeployConfig = {
    appDir: server.app_dir, repoUrl: server.repo_url, branch: server.branch, appPort,
    tenantId, slug: tenant.slug || tenant.name,
    supabaseUrl: url, supabaseAnon: anon, supabaseService: svc,
  };
  const conn: ServerConn = {
    host: server.host, port: server.port, ssh_user: server.ssh_user,
    auth_method: server.auth_method, secret_cipher: server.secret_cipher,
  };

  // Fire-and-forget: streams the log into the deployment row as it runs.
  void runDeploymentJob(depId, conn, cfg, { id: serverId, base_url: server.base_url });

  await logPlatformAction({
    action: "deploy.started", tenantId, tenantName: tenant.name,
    detail: { server: server.name, port: appPort },
  });
  return { ok: true, deploymentId: depId };
}

async function runDeploymentJob(
  depId: string,
  conn: ServerConn,
  cfg: DeployConfig,
  server: { id: string; base_url: string | null }
): Promise<void> {
  const admin = createPlatformClient();
  let buf = "";
  let dirty = false;
  const timer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    admin.from("platform_deployments").update({ log: buf }).eq("id", depId).then(() => {}, () => {});
  }, 1500);

  let result: { ok: boolean; error?: string };
  try {
    result = await runDeploy(conn, cfg, (chunk) => { buf += chunk; dirty = true; });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  clearInterval(timer);

  await admin.from("platform_deployments").update({
    log: buf + (result.ok ? "" : `\n\n✖ FAILED: ${result.error}\n`),
    status: result.ok ? "success" : "failed",
    step: result.ok ? "done" : "failed",
    base_url: server.base_url,
    finished_at: new Date().toISOString(),
  }).eq("id", depId);

  await admin.from("platform_servers").update({
    status: result.ok ? "online" : "error",
    last_checked: new Date().toISOString(),
    last_result: result.ok ? "Deployment succeeded" : (result.error || "Deployment failed"),
  }).eq("id", server.id);
}

export type DeploymentState = {
  status: string;
  step: string | null;
  log: string;
  base_url: string | null;
  finished_at: string | null;
} | null;

/** Poll a deployment's live status + log. */
export async function getDeployment(id: string): Promise<DeploymentState> {
  const admin = createPlatformClient();
  const { data } = await admin
    .from("platform_deployments")
    .select("status, step, log, base_url, finished_at")
    .eq("id", id)
    .maybeSingle();
  return (data as DeploymentState) ?? null;
}
