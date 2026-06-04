// Server-only. Thin wrapper over node-ssh for testing remote servers and
// running a full Next.js deployment over SSH. NEVER import from a client file.

import { NodeSSH } from "node-ssh";
import { decryptSecret } from "@/lib/crypto";

export type ServerConn = {
  host: string;
  port: number | null;
  ssh_user: string;
  auth_method: string; // 'key' | 'password'
  secret_cipher: string | null;
};

export type DeployConfig = {
  appDir: string;
  repoUrl?: string | null;
  branch?: string | null;
  appPort: number;
  tenantId: string;
  slug: string;
  supabaseUrl: string;
  supabaseAnon: string;
  supabaseService: string;
};

async function connect(server: ServerConn): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  const secret = decryptSecret(server.secret_cipher) || "";
  const cfg: Record<string, unknown> = {
    host: server.host,
    port: server.port || 22,
    username: server.ssh_user,
    readyTimeout: 20000,
    keepaliveInterval: 5000,
  };
  if (server.auth_method === "password") cfg.password = secret;
  else cfg.privateKey = secret;
  await ssh.connect(cfg);
  return ssh;
}

/** Quick reachability + capability probe. */
export async function testServer(server: ServerConn): Promise<{ ok: boolean; info?: string; error?: string }> {
  let ssh: NodeSSH | undefined;
  try {
    ssh = await connect(server);
    const r = await ssh.execCommand(
      "echo \"host: $(uname -n)\"; echo \"os: $(uname -s) $(uname -r)\"; echo \"node: $(node -v 2>/dev/null || echo 'not installed')\"; echo \"git: $(git --version 2>/dev/null || echo 'not installed')\"; echo \"pm2: $(pm2 -v 2>/dev/null || echo 'not installed')\""
    );
    return { ok: true, info: (r.stdout || "").trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}

export function buildEnvFile(c: DeployConfig): string {
  return (
    [
      `NEXT_PUBLIC_SUPABASE_URL=${c.supabaseUrl}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${c.supabaseAnon}`,
      `SUPABASE_SERVICE_ROLE_KEY=${c.supabaseService}`,
      `TENANT_ID=${c.tenantId}`,
      `PORT=${c.appPort}`,
      `NODE_ENV=production`,
    ].join("\n") + "\n"
  );
}

export function buildDeployScript(c: DeployConfig): string {
  const envb64 = Buffer.from(buildEnvFile(c)).toString("base64");
  const name = (c.slug || "inventory").replace(/[^a-zA-Z0-9_-]/g, "-");
  const branch = c.branch || "main";
  const source = c.repoUrl
    ? `if [ -d "$APP_DIR/.git" ]; then
  echo "==> Updating existing checkout"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard "origin/${branch}"
else
  echo "==> Cloning ${c.repoUrl} (${branch})"
  rm -rf "$APP_DIR"
  git clone --branch "${branch}" "${c.repoUrl}" "$APP_DIR"
fi`
    : `echo "==> Using existing app files already present in $APP_DIR"`;

  return `set -e
export DEBIAN_FRONTEND=noninteractive
APP_DIR="${c.appDir}"
echo "==> Deploy target: $APP_DIR  (port ${c.appPort})"
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is not installed on this server"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is not installed on this server"; exit 1; }
mkdir -p "$APP_DIR"
${source}
echo "==> Writing environment files"
echo "${envb64}" | base64 -d > "$APP_DIR/.env.local"
cat > "$APP_DIR/tenant.config.local.json" <<'JSON'
{ "tenantId": "${c.tenantId}", "installed": true }
JSON
cd "$APP_DIR"
echo "==> Installing dependencies"
if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi
echo "==> Building production bundle"
npm run build
echo "==> Ensuring process manager (pm2)"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
echo "==> (Re)starting service '${name}' on port ${c.appPort}"
pm2 delete "${name}" >/dev/null 2>&1 || true
PORT=${c.appPort} pm2 start npm --name "${name}" -- start
pm2 save || true
echo "==> Deploy complete. Service '${name}' is live on port ${c.appPort}."`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Run a deployment, streaming combined output to onLog. */
export async function runDeploy(
  server: ServerConn,
  c: DeployConfig,
  onLog: (chunk: string) => void
): Promise<{ ok: boolean; error?: string }> {
  let ssh: NodeSSH | undefined;
  try {
    onLog(`Connecting to ${server.ssh_user}@${server.host}:${server.port || 22} …\n`);
    ssh = await connect(server);
    onLog("Connected. Starting deployment…\n\n");
    const script = buildDeployScript(c);
    const res = await ssh.execCommand(`bash -lc ${shellQuote(script)}`, {
      onStdout: (b) => onLog(b.toString("utf8")),
      onStderr: (b) => onLog(b.toString("utf8")),
    });
    if (res.code !== 0) return { ok: false, error: `Remote process exited with code ${res.code}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}
