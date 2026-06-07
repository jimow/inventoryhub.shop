// Server-only. Thin wrapper over node-ssh for testing remote servers and
// running a full Next.js deployment over SSH — including bootstrapping a BARE
// server (installs Node.js, git, pm2) and uploading the app over SFTP when no
// git repo is configured. NEVER import from a client file.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  supabaseUrl: string;
  supabaseAnon: string;
  supabaseService: string;
  /** 'repo' = git clone/pull on the server; 'upload' = SFTP this folder up. */
  source: "repo" | "upload";
  /** Local project root to upload when source === 'upload'. */
  localRoot?: string;
  /** Public domain to reverse-proxy with nginx (optional). */
  domain?: string | null;
  /** Email used by certbot when issuing the Let's Encrypt certificate. */
  sslEmail?: string | null;
  /** Issue HTTPS via certbot (requires domain + DNS pointing here). */
  setupSsl?: boolean;
  /** Also serve www.<domain>. */
  wwwAlias?: boolean;
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
      "echo \"host: $(uname -n)\"; echo \"os: $(uname -s) $(uname -r)\"; echo \"user: $(whoami) (uid $(id -u))\"; echo \"node: $(node -v 2>/dev/null || echo 'not installed')\"; echo \"git: $(git --version 2>/dev/null || echo 'not installed')\"; echo \"pm2: $(pm2 -v 2>/dev/null || echo 'not installed')\""
    );
    return { ok: true, info: (r.stdout || "").trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}

/** Gather a live health report from a server (pm2, app port, nginx, logs). */
export async function diagnoseServer(
  server: ServerConn,
  opts: { appPort: number; domain?: string | null }
): Promise<{ ok: boolean; info?: string; error?: string }> {
  let ssh: NodeSSH | undefined;
  try {
    ssh = await connect(server);
    const script = `echo "### pm2 processes ###"
pm2 list 2>/dev/null || echo "pm2 not available"
echo
echo "### app responding on 127.0.0.1:${opts.appPort}? ###"
curl -sS -m 5 -o /dev/null -w "HTTP %{http_code}\\n" http://127.0.0.1:${opts.appPort} 2>&1 || echo "NO RESPONSE on port ${opts.appPort} (app is down)"
echo
echo "### nginx ###"
echo "active: $(systemctl is-active nginx 2>/dev/null)"
$([ "$(id -u)" -eq 0 ] && echo "" || echo "sudo -n ")nginx -t 2>&1 | tail -n 2
echo
echo "### listeners (80 / 443 / app) ###"
(ss -ltnp 2>/dev/null | grep -E ':80 |:443 |:${opts.appPort} ') || echo "none"
echo
echo "### recent app error logs ###"
tail -n 40 ~/.pm2/logs/*error*.log 2>/dev/null || echo "no pm2 error logs found"
${opts.domain ? `echo
echo "### TLS certificate ###"
ls -1 /etc/letsencrypt/live/${opts.domain}/ 2>/dev/null || echo "no certificate dir for ${opts.domain}"` : ""}`;
    const r = await ssh.execCommand(`bash -lc ${shellQuote(script)}`);
    return { ok: true, info: `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}

/** Bring the app back up: resurrect/restart pm2 processes. */
export async function restartApp(server: ServerConn): Promise<{ ok: boolean; info?: string; error?: string }> {
  let ssh: NodeSSH | undefined;
  try {
    ssh = await connect(server);
    const script = `pm2 resurrect 2>/dev/null || true
pm2 restart all 2>/dev/null || true
pm2 save 2>/dev/null || true
echo "--- pm2 after restart ---"
pm2 list 2>/dev/null || echo "pm2 not available"`;
    const r = await ssh.execCommand(`bash -lc ${shellQuote(script)}`);
    return { ok: true, info: `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}

// ---------------------------------------------------------------------------
// One-click server operations (run from the platform console, never via SSH).
// ---------------------------------------------------------------------------
type OpCtx = { appPort: number; domain?: string | null; appDir: string };

const SERVER_OP_SCRIPTS: Record<string, (c: OpCtx) => string> = {
  // App / pm2
  app_status: () => `pm2 list 2>/dev/null || echo "pm2 not available"`,
  app_health: (c) => `curl -sS -m 6 -o /dev/null -w "HTTP %{http_code}\\n" http://127.0.0.1:${c.appPort} 2>&1 || echo "NO RESPONSE on 127.0.0.1:${c.appPort} — the app is down"`,
  app_restart: () => `pm2 resurrect 2>/dev/null || true
pm2 restart all 2>/dev/null || true
pm2 save 2>/dev/null || true
echo "--- pm2 ---"; pm2 list 2>/dev/null`,
  app_stop: () => `pm2 stop all 2>/dev/null || true; echo "--- pm2 ---"; pm2 list 2>/dev/null`,
  app_start: () => `pm2 resurrect 2>/dev/null || true; pm2 start all 2>/dev/null || true; pm2 save 2>/dev/null || true; echo "--- pm2 ---"; pm2 list 2>/dev/null`,
  app_logs: () => `echo "### stdout (last 60) ###"; tail -n 60 ~/.pm2/logs/*out*.log 2>/dev/null || echo "none"; echo; echo "### errors (last 60) ###"; tail -n 60 ~/.pm2/logs/*error*.log 2>/dev/null || echo "none"`,

  // Web server / nginx
  nginx_status: () => `echo "active: $($SUDO systemctl is-active nginx 2>/dev/null)"; $SUDO nginx -t 2>&1 | tail -n 2`,
  nginx_reload: () => `$SUDO nginx -t && $SUDO systemctl reload nginx && echo "nginx reloaded" || echo "reload failed (config invalid?)"`,
  nginx_restart: () => `$SUDO systemctl restart nginx && echo "nginx restarted: $($SUDO systemctl is-active nginx)" || echo "restart failed"`,
  nginx_logs: () => `$SUDO tail -n 80 /var/log/nginx/error.log 2>/dev/null || echo "no nginx error log"`,
  free_ports: () => `$SUDO fuser -k 80/tcp >/dev/null 2>&1 || true; $SUDO fuser -k 443/tcp >/dev/null 2>&1 || true; $SUDO pkill -x nginx >/dev/null 2>&1 || true; sleep 1; $SUDO systemctl start nginx 2>/dev/null || true; echo "freed ports 80/443 and (re)started nginx: $($SUDO systemctl is-active nginx)"`,

  // SSL
  ssl_info: () => `$SUDO certbot certificates 2>/dev/null || echo "certbot not available"`,
  ssl_renew: () => `$SUDO certbot renew --nginx --non-interactive 2>&1 | tail -n 30; echo "---"; $SUDO certbot certificates 2>/dev/null | grep -E "Certificate Name|Domains|Expiry" || true`,

  // System
  sys_resources: () => `echo "### uptime / load ###"; uptime; echo; echo "### memory ###"; free -h; echo; echo "### disk ###"; df -h /; echo; echo "### swap ###"; (swapon --show 2>/dev/null || echo "no swap"); echo; echo "### top memory processes ###"; ps aux --sort=-%mem 2>/dev/null | head -n 8`,
  create_swap: () => `if swapon --show 2>/dev/null | grep -q .; then echo "swap already active:"; swapon --show; else
  echo "creating 2G swap file..."
  $SUDO fallocate -l 2G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048
  $SUDO chmod 600 /swapfile; $SUDO mkswap /swapfile; $SUDO swapon /swapfile
  grep -q "/swapfile" /etc/fstab 2>/dev/null || echo "/swapfile none swap sw 0 0" | $SUDO tee -a /etc/fstab >/dev/null
  echo "swap enabled:"; swapon --show; fi`,
  sys_update: () => `export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -y && $SUDO apt-get upgrade -y
elif command -v dnf >/dev/null 2>&1; then $SUDO dnf upgrade -y
elif command -v yum >/dev/null 2>&1; then $SUDO yum update -y; fi
echo "system packages updated"`,
  restart_all: () => `pm2 restart all 2>/dev/null || true; pm2 save 2>/dev/null || true; $SUDO systemctl restart nginx 2>/dev/null || true; echo "app + nginx restarted"; echo "nginx: $($SUDO systemctl is-active nginx)"; pm2 list 2>/dev/null`,
  reboot: () => `echo "reboot scheduled"; ( sleep 2; $SUDO reboot ) >/dev/null 2>&1 &`,

  // App maintenance (fix/rebuild without re-uploading)
  npm_update: () => `echo "Updating npm…"; $SUDO npm install -g npm@latest >/dev/null 2>&1 || npm install -g npm@latest >/dev/null 2>&1 || true; hash -r 2>/dev/null || true; echo "npm is now $(npm -v 2>/dev/null)"`,
  app_reinstall: (c) => `cd "${c.appDir}" || { echo "No app directory ${c.appDir}"; exit 1; }
echo "==> Installing with pnpm (corepack) — bypasses the broken npm"
corepack enable >/dev/null 2>&1 || $SUDO corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9 --activate >/dev/null 2>&1 || corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
rm -rf node_modules
if command -v pnpm >/dev/null 2>&1; then echo "pnpm $(pnpm -v)"; NODE_ENV=development pnpm install --shamefully-hoist --no-strict-peer-dependencies 2>&1 | tail -15; fi
if [ ! -x node_modules/.bin/next ]; then
  echo "==> pnpm incomplete — trying npm"
  $SUDO npm install -g npm@latest >/dev/null 2>&1 || npm install -g npm@latest >/dev/null 2>&1 || true
  hash -r 2>/dev/null || true; npm cache clean --force >/dev/null 2>&1 || true
  NODE_ENV=development npm install --no-audit --no-fund 2>&1 | tail -15
fi
[ -x node_modules/.bin/next ] && echo "✓ dependencies OK (next CLI present)" || echo "✗ next CLI still missing"`,
  app_rebuild: (c) => `cd "${c.appDir}" || { echo "No app directory ${c.appDir}"; exit 1; }
echo "==> Building (this can take a few minutes)"
./node_modules/.bin/next build 2>&1 | tail -25
echo "==> Restarting app"
pm2 restart all 2>/dev/null || true
pm2 save 2>/dev/null || true
pm2 list 2>/dev/null`,
};

export const SERVER_OP_KEYS = Object.keys(SERVER_OP_SCRIPTS);

/** Run a named server operation over SSH and return its output. */
export async function runServerOp(
  server: ServerConn,
  opKey: string,
  ctx: OpCtx
): Promise<{ ok: boolean; info?: string; error?: string }> {
  const fn = SERVER_OP_SCRIPTS[opKey];
  if (!fn) return { ok: false, error: `Unknown operation: ${opKey}` };
  let ssh: NodeSSH | undefined;
  try {
    ssh = await connect(server);
    const script = `SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi
${fn(ctx)}`;
    const r = await ssh.execCommand(`bash -lc ${shellQuote(script)}`);
    return { ok: true, info: `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim() || "Done." };
  } catch (e) {
    if (opKey === "reboot") return { ok: true, info: "Reboot command sent (the SSH connection drops, as expected). Give it ~30–60s." };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}

/** A stable pm2 / nginx site name for a server, derived from its app directory. */
function deployName(appDir: string): string {
  return (path.basename(appDir || "") || "inventory").replace(/[^a-zA-Z0-9_-]/g, "-") || "inventory";
}

export function buildEnvFile(c: DeployConfig): string {
  // NOTE: deliberately NO TENANT_ID — a freshly deployed app ships UNINSTALLED so
  // the operator's first screen is /install, where they name the shop. This
  // avoids the "already-installed inventory" confusion entirely.
  return (
    [
      `NEXT_PUBLIC_SUPABASE_URL=${c.supabaseUrl}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${c.supabaseAnon}`,
      `SUPABASE_SERVICE_ROLE_KEY=${c.supabaseService}`,
      `PORT=${c.appPort}`,
      `NODE_ENV=production`,
      // SECURITY: a tenant shop must never expose the cross-tenant super-admin console.
      `PLATFORM_CONSOLE_ENABLED=false`,
    ].join("\n") + "\n"
  );
}

/** Installs Node.js 20, git and pm2 on a bare server. Idempotent. */
export function buildBootstrapScript(): string {
  return `set -e
SUDO=""
SUDO_E=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; SUDO_E="sudo -n -E"; fi
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "Node already present: $(node -v)"
else
  echo "Installing Node.js 20 + tools..."
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y curl git ca-certificates build-essential python3
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO_E bash -
    $SUDO apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y curl git gcc-c++ make python3
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO_E bash -
    $SUDO dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y curl git gcc-c++ make python3
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO_E bash -
    $SUDO yum install -y nodejs
  else
    echo "ERROR: no supported package manager (apt/dnf/yum) found"; exit 1
  fi
fi
if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get install -y git; fi
fi
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2 || npm install -g pm2
fi
# Low-memory safety: create swap so the build/runtime doesn't get OOM-killed.
MEM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')
if [ -n "$MEM_MB" ] && [ "$MEM_MB" -lt 2048 ] && ! swapon --show 2>/dev/null | grep -q .; then
  echo "Low memory ($MEM_MB MB) and no swap detected — creating a 2G swap file"
  $SUDO fallocate -l 2G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048
  $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile && $SUDO swapon /swapfile
  grep -q "/swapfile" /etc/fstab 2>/dev/null || echo "/swapfile none swap sw 0 0" | $SUDO tee -a /etc/fstab >/dev/null
  echo "swap enabled:"; swapon --show 2>/dev/null || true
fi
echo "Server ready: node $(node -v), npm $(npm -v), pm2 $(pm2 -v 2>/dev/null || echo '?')"`;
}

/** Writes env, installs deps, builds and (re)starts the app under pm2. */
export function buildAppScript(c: DeployConfig): string {
  const envb64 = Buffer.from(buildEnvFile(c)).toString("base64");
  const name = deployName(c.appDir);
  const branch = c.branch || "main";
  const fetchStep =
    c.source === "repo" && c.repoUrl
      ? `if [ -d "$APP_DIR/.git" ]; then
  echo "==> Updating existing checkout"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard "origin/${branch}"
else
  echo "==> Cloning ${c.repoUrl} (${branch})"
  rm -rf "$APP_DIR"
  git clone --branch "${branch}" "${c.repoUrl}" "$APP_DIR"
fi`
      : `echo "==> Using uploaded application files in $APP_DIR"`;

  return `set -e
export PATH="$PATH:/usr/local/bin:/usr/bin"
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi
APP_DIR="${c.appDir}"
mkdir -p "$APP_DIR"
${fetchStep}
echo "==> Writing environment (Supabase connection)"
# Refresh only the env file; PRESERVE tenant.config.local.json so a re-deploy
# keeps an already-installed shop installed (we never upload it either).
rm -f "$APP_DIR"/.env "$APP_DIR"/.env.* 2>/dev/null || true
echo "${envb64}" | base64 -d > "$APP_DIR/.env.local"
echo "==> App ships uninstalled — the first visit opens /install to name the shop."
cd "$APP_DIR"
# npm install + next build are memory-hungry. On a small VPS without swap they
# get OOM-killed (npm: "Exit handler never called"). Guarantee swap headroom.
TOTAL_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')
SWAP_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}')
echo "==> Resources: RAM \${TOTAL_MB:-?}MB, swap \${SWAP_MB:-0}MB, disk: $(df -h "$APP_DIR" 2>/dev/null | awk 'NR==2{print $4" free"}')"
if [ "\${SWAP_MB:-0}" -lt 2048 ]; then
  echo "==> Adding swap so npm/next don't get OOM-killed"
  if [ ! -e /swapfile ]; then
    $SUDO fallocate -l 4G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=4096
    $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile
  fi
  $SUDO swapon /swapfile 2>/dev/null || true
  grep -q "/swapfile" /etc/fstab 2>/dev/null || echo "/swapfile none swap sw 0 0" | $SUDO tee -a /etc/fstab >/dev/null
  free -h 2>/dev/null | awk '/^Swap:/{print "    swap now:", $0}'
fi
export NODE_OPTIONS="--max-old-space-size=2048"
echo "==> Checking dependencies"
NEED_INSTALL=1
# Skip install only if deps are unchanged AND the build tool actually exists.
if [ -x node_modules/.bin/next ] && [ -f .deploy-lock-hash ] && [ -f package-lock.json ]; then
  if [ "$(sha1sum package-lock.json | awk '{print $1}')" = "$(cat .deploy-lock-hash 2>/dev/null)" ]; then NEED_INSTALL=0; fi
fi
if [ "$NEED_INSTALL" = "0" ]; then
  echo "    dependencies unchanged — skipping install"
else
  # Primary: pnpm via corepack. corepack ships with Node and fetches pnpm
  # itself, so it works even when this server's npm is broken (the "Exit
  # handler never called" bug). pnpm also installs reliably & fast.
  echo "    installing dependencies with pnpm (corepack) — bypasses the broken npm"
  corepack enable >/dev/null 2>&1 || $SUDO corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@9 --activate >/dev/null 2>&1 || corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
  if command -v pnpm >/dev/null 2>&1; then
    echo "    pnpm $(pnpm -v 2>/dev/null)"
    NODE_ENV=development pnpm install --shamefully-hoist --no-strict-peer-dependencies 2>&1 | tail -20 || true
  else
    echo "    corepack/pnpm unavailable"
  fi
  # Fallback: refresh npm and try it, in case pnpm couldn't be fetched.
  if [ ! -x node_modules/.bin/next ]; then
    echo "    pnpm path incomplete — refreshing npm and retrying"
    npm install -g npm@latest >/dev/null 2>&1 || $SUDO npm install -g npm@latest >/dev/null 2>&1 || true
    hash -r 2>/dev/null || true
    npm cache clean --force >/dev/null 2>&1 || true
    rm -rf node_modules
    NODE_ENV=development npm install --no-audit --no-fund 2>&1 | tail -20 || true
  fi
  [ -x node_modules/.bin/next ] && [ -f package-lock.json ] && sha1sum package-lock.json | awk '{print $1}' > .deploy-lock-hash || true
fi
if [ ! -x node_modules/.bin/next ]; then
  echo "✖ Dependencies failed to install. Last npm debug log (if any):"
  tail -n 30 "$(ls -t /root/.npm/_logs/*debug-0.log 2>/dev/null | head -1)" 2>/dev/null || true
  exit 1
fi
echo "==> Building production bundle"
./node_modules/.bin/next build
command -v pm2 >/dev/null 2>&1 || $SUDO npm install -g pm2 || npm install -g pm2
echo "==> (Re)starting service '${name}' on port ${c.appPort}"
# One server hosts one shop: clear any previous app + free the port so the new
# tenant's process binds cleanly (prevents stale shops from lingering).
pm2 delete all >/dev/null 2>&1 || true
$SUDO fuser -k ${c.appPort}/tcp >/dev/null 2>&1 || true
sleep 1
PORT=${c.appPort} pm2 start npm --name "${name}" -- start
pm2 save || true
echo "==> Enabling start-on-boot"
$SUDO env PATH="$PATH:$(dirname "$(command -v node)")" pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null 2>&1 || true
pm2 save || true
echo "==> Done. '${name}' is live on 127.0.0.1:${c.appPort}."`;
}

/** Installs + configures nginx as a reverse proxy for the domain, and (optionally)
 *  issues a Let's Encrypt certificate with certbot. Requires a domain. */
export function buildWebServerScript(c: DeployConfig): string {
  const name = deployName(c.appDir);
  const domain = (c.domain || "").trim();
  const serverNames = [domain, c.wwwAlias ? `www.${domain}` : ""].filter(Boolean).join(" ");
  const certDomains = [domain, c.wwwAlias ? `www.${domain}` : ""].filter(Boolean).map((d) => `-d ${d}`).join(" ");
  const wantSsl = !!c.setupSsl && !!c.sslEmail;

  // nginx vars ($host, $remote_addr, …) are written literally via a quoted heredoc.
  const nginxConf = `server {
    listen 80;
    server_name ${serverNames};

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:${c.appPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
    }
}`;

  return `set -e
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi
echo "==> Ensuring nginx${wantSsl ? " + certbot" : ""}"
NGX_PKGS=""
command -v nginx >/dev/null 2>&1 || NGX_PKGS="nginx"
${wantSsl ? `command -v certbot >/dev/null 2>&1 || NGX_PKGS="$NGX_PKGS certbot python3-certbot-nginx"` : ``}
if [ -n "$NGX_PKGS" ]; then
  echo "    installing:$NGX_PKGS"
  if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -y; $SUDO apt-get install -y $NGX_PKGS;
  elif command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y $NGX_PKGS;
  elif command -v yum >/dev/null 2>&1; then $SUDO yum install -y $NGX_PKGS; fi
else
  echo "    nginx${wantSsl ? " and certbot are" : " is"} already installed — skipping"
fi
echo "==> Writing nginx site for ${serverNames}"
if [ -d /etc/nginx/sites-available ]; then
  NGX=/etc/nginx/sites-available/${name}.conf
  $SUDO tee "$NGX" >/dev/null <<'NGINX'
${nginxConf}
NGINX
  $SUDO ln -sf "$NGX" /etc/nginx/sites-enabled/${name}.conf
  $SUDO rm -f /etc/nginx/sites-enabled/default
else
  NGX=/etc/nginx/conf.d/${name}.conf
  $SUDO tee "$NGX" >/dev/null <<'NGINX'
${nginxConf}
NGINX
fi
echo "==> Testing nginx configuration"
$SUDO nginx -t
$SUDO systemctl enable nginx >/dev/null 2>&1 || true
echo "==> (Re)starting nginx cleanly"
# Stop any nginx already running (systemd-managed OR an orphaned master that
# would otherwise keep holding :80/:443 and block the new instance from binding).
$SUDO systemctl stop nginx >/dev/null 2>&1 || true
$SUDO nginx -s quit >/dev/null 2>&1 || true
for i in 1 2 3 4 5; do
  if $SUDO ss -ltn 2>/dev/null | grep -qE ':80 |:443 '; then
    $SUDO pkill -x nginx >/dev/null 2>&1 || true
    sleep 1
  else
    break
  fi
done
if ! $SUDO systemctl start nginx; then
  echo "----- nginx failed to start; diagnosing -----"
  $SUDO systemctl status nginx --no-pager -l 2>&1 | tail -n 20 || true
  $SUDO journalctl -xeu nginx.service --no-pager 2>&1 | tail -n 30 || true
  echo "----- listeners on :80 / :443 -----"
  ($SUDO ss -ltnp 2>/dev/null | grep -E ':80 |:443 ') || true
  if $SUDO ss -ltnp 2>/dev/null | grep -q apache2; then
    echo "Apache is holding port 80 — stopping & disabling it."
    $SUDO systemctl stop apache2 >/dev/null 2>&1 || true
    $SUDO systemctl disable apache2 >/dev/null 2>&1 || true
  fi
  echo "Freeing ports 80/443 and retrying..."
  $SUDO fuser -k 80/tcp >/dev/null 2>&1 || true
  $SUDO fuser -k 443/tcp >/dev/null 2>&1 || true
  $SUDO pkill -x nginx >/dev/null 2>&1 || true
  sleep 2
  $SUDO systemctl start nginx
fi
echo "==> nginx is running"
if command -v ufw >/dev/null 2>&1; then
  $SUDO ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  $SUDO ufw allow OpenSSH >/dev/null 2>&1 || true
fi
${wantSsl ? `if [ -f /etc/letsencrypt/live/${domain}/fullchain.pem ]; then
  echo "==> SSL certificate already present for ${domain} — keeping it (skipping issuance)"
  $SUDO certbot --nginx --non-interactive --agree-tos -m ${c.sslEmail} ${certDomains} --keep-until-expiring --redirect >/dev/null 2>&1 || true
else
  echo "==> Requesting Let's Encrypt certificate for ${domain}"
  if $SUDO certbot --nginx --non-interactive --agree-tos -m ${c.sslEmail} ${certDomains} --redirect; then
    echo "==> HTTPS enabled for ${domain}"
  ${c.wwwAlias ? `elif $SUDO certbot --nginx --non-interactive --agree-tos -m ${c.sslEmail} -d ${domain} --redirect; then
    echo "==> HTTPS enabled for ${domain} (www. skipped — no DNS record for www.${domain}; add one and redeploy to include it)"` : ``}
  else
    echo "WARN: certbot could not issue a certificate. Most common cause: DNS for ${domain} is not yet pointing to this server's IP. The site still works over http://${domain}; re-deploy once DNS propagates."
  fi
fi` : `echo "==> Serving on http://${domain} (SSL not requested)"`}
echo "==> Web server configuration complete."`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const EXCLUDE_DIRS = new Set([
  "node_modules", ".next", ".git", ".turbo", ".vercel", ".cache", "dist", "out",
]);
const EXCLUDE_FILES = new Set([
  "tenant.config.local.json", "npm-debug.log",
  ".deploy-manifest.json", ".deploy-lock-hash",
]);

/** A file that must never be uploaded (build artifact, secret, or tenant binding). */
function isExcludedFile(name: string): boolean {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith(".env")) return true;          // .env, .env.local, .env.production, …
  if (name.endsWith(".local.json")) return true;     // any *.local.json (tenant binding)
  if (name.endsWith(".pem")) return true;
  if (name.startsWith("deploy_key")) return true;
  return false;
}

type Manifest = Record<string, string>;

/** Recursively list uploadable files (relative POSIX paths), applying excludes. */
function walkLocal(root: string): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        walk(abs);
      } else if (e.isFile()) {
        if (isExcludedFile(e.name)) continue;
        out.push({ abs, rel: path.relative(root, abs).split(path.sep).join("/") });
      }
    }
  };
  walk(root);
  return out;
}

function hashFile(abs: string): string {
  return crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
}

/**
 * Incremental upload: compares local files against a manifest stored on the
 * server from the previous deploy, and transfers ONLY new/changed files (and
 * removes files deleted locally). Writes the refreshed manifest afterwards.
 */
async function syncDirectory(
  ssh: NodeSSH,
  localRoot: string,
  remoteDir: string,
  onLog: (s: string) => void
): Promise<{ ok: boolean; error?: string; changed: number }> {
  await ssh.execCommand(`mkdir -p ${shellQuote(remoteDir)}`);

  // Load the previous manifest (if any).
  const manPath = `${remoteDir}/.deploy-manifest.json`;
  const manRes = await ssh.execCommand(`cat ${shellQuote(manPath)} 2>/dev/null || true`);
  let prev: Manifest = {};
  try { prev = (JSON.parse(manRes.stdout || "{}") as Manifest) || {}; } catch { prev = {}; }

  // Hash the local tree.
  const files = walkLocal(localRoot);
  const next: Manifest = {};
  const changed: { abs: string; rel: string }[] = [];
  for (const f of files) {
    const h = hashFile(f.abs);
    next[f.rel] = h;
    if (prev[f.rel] !== h) changed.push(f);
  }
  const removed = Object.keys(prev).filter((rel) => !(rel in next));

  const firstTime = Object.keys(prev).length === 0;
  onLog(
    `${firstTime ? "First deploy — uploading everything. " : ""}` +
    `Local: ${files.length} files. New/changed: ${changed.length}. Unchanged: ${files.length - changed.length}. Removed: ${removed.length}.\n`
  );

  if (changed.length === 0 && removed.length === 0) {
    onLog("No file changes since the last deploy — skipping upload.\n");
    return { ok: true, changed: 0 };
  }

  // Create needed remote directories.
  if (changed.length) {
    const dirs = Array.from(new Set(changed.map((f) => {
      const d = path.posix.dirname(f.rel);
      return d === "." ? remoteDir : `${remoteDir}/${d}`;
    })));
    for (let i = 0; i < dirs.length; i += 100) {
      const chunk = dirs.slice(i, i + 100).map(shellQuote).join(" ");
      await ssh.execCommand(`mkdir -p ${chunk}`);
    }
    // Transfer changed files in batches.
    let done = 0;
    for (let i = 0; i < changed.length; i += 40) {
      const batch = changed.slice(i, i + 40).map((f) => ({ local: f.abs, remote: `${remoteDir}/${f.rel}` }));
      await ssh.putFiles(batch, { concurrency: 8 });
      done += batch.length;
      onLog(`  … uploaded ${done}/${changed.length}\n`);
    }
  }

  // Remove files deleted locally.
  if (removed.length) {
    for (let i = 0; i < removed.length; i += 100) {
      const chunk = removed.slice(i, i + 100).map((rel) => shellQuote(`${remoteDir}/${rel}`)).join(" ");
      await ssh.execCommand(`rm -f ${chunk}`);
    }
    onLog(`  removed ${removed.length} deleted file(s).\n`);
  }

  // Persist the refreshed manifest.
  const manB64 = Buffer.from(JSON.stringify(next)).toString("base64");
  await ssh.execCommand(`echo ${shellQuote(manB64)} | base64 -d > ${shellQuote(manPath)}`);

  return { ok: true, changed: changed.length };
}

/** Run a full deployment, streaming combined output to onLog. */
export async function runDeploy(
  server: ServerConn,
  c: DeployConfig,
  onLog: (chunk: string) => void
): Promise<{ ok: boolean; error?: string }> {
  let ssh: NodeSSH | undefined;
  try {
    onLog(`Connecting to ${server.ssh_user}@${server.host}:${server.port || 22} …\n`);
    ssh = await connect(server);
    onLog("Connected.\n");

    // Phase 1 — bootstrap a bare server (idempotent).
    onLog("\n=== Preparing server (Node.js, git, pm2) ===\n");
    const boot = await ssh.execCommand(`bash -lc ${shellQuote(buildBootstrapScript())}`, {
      onStdout: (b) => onLog(b.toString("utf8")),
      onStderr: (b) => onLog(b.toString("utf8")),
    });
    if (boot.code !== 0) {
      return {
        ok: false,
        error:
          `Server preparation failed (exit ${boot.code}). If you log in as a non-root user, ` +
          `passwordless sudo is required to install system packages.`,
      };
    }

    // Phase 2 — get the code onto the server (incremental: only new/changed files).
    if (c.source === "upload") {
      const localRoot = c.localRoot || process.cwd();
      onLog(`\n=== Syncing application files from ${localRoot} ===\n`);
      const sync = await syncDirectory(ssh, localRoot, c.appDir, onLog);
      if (!sync.ok) return { ok: false, error: sync.error || "File sync failed." };
    }

    // Phase 3 — build + start.
    onLog("\n=== Building & starting the app ===\n");
    const app = await ssh.execCommand(`bash -lc ${shellQuote(buildAppScript(c))}`, {
      onStdout: (b) => onLog(b.toString("utf8")),
      onStderr: (b) => onLog(b.toString("utf8")),
    });
    if (app.code !== 0) return { ok: false, error: `Build/start failed (exit ${app.code}).` };

    // Phase 4 — domain + HTTPS (nginx reverse proxy + Let's Encrypt).
    if (c.domain && c.domain.trim()) {
      onLog(`\n=== Configuring domain ${c.domain}${c.setupSsl && c.sslEmail ? " + HTTPS" : ""} ===\n`);
      const web = await ssh.execCommand(`bash -lc ${shellQuote(buildWebServerScript(c))}`, {
        onStdout: (b) => onLog(b.toString("utf8")),
        onStderr: (b) => onLog(b.toString("utf8")),
      });
      if (web.code !== 0) return { ok: false, error: `Domain/SSL configuration failed (exit ${web.code}).` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { ssh?.dispose(); } catch { /* noop */ }
  }
}
