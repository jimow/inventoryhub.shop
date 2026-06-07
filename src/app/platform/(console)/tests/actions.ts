"use server";

import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { createPlatformClient, getPlatformSession } from "@/lib/platform";

const exec = promisify(execCb);

export type CheckStatus = "pass" | "fail" | "warn";
export type CheckResult = { category: string; name: string; status: CheckStatus; detail: string };

type Admin = ReturnType<typeof createPlatformClient>;

async function tableOk(admin: Admin, table: string): Promise<{ ok: boolean; count: number; error?: string }> {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  return { ok: !error, count: count ?? 0, error: error?.message };
}

/** Run the live production-readiness suite against the real system. */
export async function runReadinessChecks(): Promise<CheckResult[]> {
  const session = await getPlatformSession();
  if (!session) return [{ category: "Auth", name: "Authorization", status: "fail", detail: "Not signed in as a platform admin." }];

  const admin = createPlatformClient();
  const results: CheckResult[] = [];
  const push = (category: string, name: string, status: CheckStatus, detail: string) =>
    results.push({ category, name, status, detail });
  const safe = async (category: string, name: string, fn: () => Promise<{ status: CheckStatus; detail: string }>) => {
    try { const r = await fn(); push(category, name, r.status, r.detail); }
    catch (e) { push(category, name, "fail", e instanceof Error ? e.message : String(e)); }
  };

  // --- Configuration ---
  const envCheck = (name: string, key: string, required = true) => {
    const v = process.env[key];
    push("Configuration", name, v ? "pass" : required ? "fail" : "warn",
      v ? "Set" : `${key} is not set${required ? "" : " (optional, uses a fallback)"}`);
  };
  envCheck("Supabase URL", "NEXT_PUBLIC_SUPABASE_URL");
  envCheck("Supabase anon key", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  envCheck("Supabase service-role key", "SUPABASE_SERVICE_ROLE_KEY");
  envCheck("Platform secret key", "PLATFORM_SECRET_KEY", false);

  // --- Database & platform tables ---
  for (const [label, table] of [
    ["Tenants table", "tenants"],
    ["Platform admins table", "platform_admins"],
    ["Platform audit table", "platform_audit"],
    ["Servers table", "platform_servers"],
    ["Deployments table", "platform_deployments"],
    ["Activity log table", "activity_log"],
  ] as const) {
    await safe("Database", label, async () => {
      const r = await tableOk(admin, table);
      return r.ok ? { status: "pass", detail: `${r.count} row(s)` } : { status: "fail", detail: r.error || "unreachable" };
    });
  }

  // --- Schema / migrations ---
  const columnCheck = (label: string, table: string, column: string) =>
    safe("Schema", label, async () => {
      const { error } = await admin.from(table).select(column).limit(1);
      return error ? { status: "fail", detail: `${table}.${column}: ${error.message}` } : { status: "pass", detail: `${table}.${column} present` };
    });
  await columnCheck("Tenant lifecycle status (00036)", "tenants", "status");
  await columnCheck("Customer opening balance (00029)", "customers", "opening_balance");
  await columnCheck("Payment fee (00030)", "payments", "fee");
  await columnCheck("Server domain/SSL (00038)", "platform_servers", "domain");
  await safe("Schema", "Returns tables (00033)", async () => {
    const r = await tableOk(admin, "sales_returns");
    return r.ok ? { status: "pass", detail: "sales_returns present" } : { status: "fail", detail: r.error || "missing" };
  });

  // --- Security ---
  await safe("Security", "A platform admin exists", async () => {
    const r = await tableOk(admin, "platform_admins");
    return r.count > 0 ? { status: "pass", detail: `${r.count} admin(s)` } : { status: "fail", detail: "No platform admin — the console would be unclaimable." };
  });

  // --- Tenant integrity ---
  await safe("Tenants", "Every workspace has an Administrator", async () => {
    const [{ data: tenants }, { data: roles }] = await Promise.all([
      admin.from("tenants").select("id, name"),
      admin.from("roles").select("tenant_id").eq("name", "Administrator"),
    ]);
    const have = new Set((roles || []).map((r) => r.tenant_id as string));
    const missing = (tenants || []).filter((t) => !have.has(t.id as string));
    return missing.length === 0
      ? { status: "pass", detail: `${(tenants || []).length} workspace(s) OK` }
      : { status: "warn", detail: `${missing.length} without an Administrator role: ${missing.slice(0, 3).map((t) => t.name).join(", ")}` };
  });
  await safe("Tenants", "Every workspace has settings", async () => {
    const [{ count: t }, { count: s }] = await Promise.all([
      admin.from("tenants").select("*", { count: "exact", head: true }),
      admin.from("settings").select("*", { count: "exact", head: true }),
    ]);
    return (t ?? 0) === (s ?? 0)
      ? { status: "pass", detail: `${s ?? 0} settings row(s) for ${t ?? 0} workspace(s)` }
      : { status: "warn", detail: `${t ?? 0} workspaces but ${s ?? 0} settings rows` };
  });

  // --- Accounting integrity ---
  await safe("Accounting", "Journals are balanced (debit = credit)", async () => {
    const { count, error } = await admin.from("journal_lines").select("*", { count: "exact", head: true });
    if (error) return { status: "fail", detail: error.message };
    if ((count ?? 0) === 0) return { status: "pass", detail: "No journal lines yet" };
    if ((count ?? 0) > 50000) return { status: "warn", detail: `Skipped — ${count} lines is large; check per-tenant instead.` };
    const { data, error: e2 } = await admin.from("journal_lines").select("debit, credit").limit(50000);
    if (e2) return { status: "fail", detail: e2.message };
    let d = 0, c = 0;
    for (const r of data || []) { d += Number(r.debit) || 0; c += Number(r.credit) || 0; }
    const diff = Math.abs(d - c);
    return diff < 0.01
      ? { status: "pass", detail: `Balanced across ${count} lines (Σdr=Σcr=${d.toFixed(2)})` }
      : { status: "fail", detail: `Out of balance by ${diff.toFixed(2)} (Σdr=${d.toFixed(2)}, Σcr=${c.toFixed(2)})` };
  });

  return results;
}

/**
 * Functional correctness audit for ONE workspace: verifies the system entered
 * journals correctly and that derived figures reconcile to their source
 * documents. Read-only.
 */
export async function runFunctionalTests(tenantId: string): Promise<CheckResult[]> {
  const session = await getPlatformSession();
  if (!session) return [{ category: "Auth", name: "Authorization", status: "fail", detail: "Not authorized." }];
  if (!tenantId) return [{ category: "Functional", name: "Select a workspace", status: "warn", detail: "Choose a workspace to audit." }];

  const admin = createPlatformClient();
  const out: CheckResult[] = [];
  const push = (category: string, name: string, status: CheckStatus, detail: string) => out.push({ category, name, status, detail });
  const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

  try {
    const LIMIT = 60000;
    const [acc, ent, lns, sal, pur, pay, cus, sup] = await Promise.all([
      admin.from("accounts").select("id, code, type").eq("tenant_id", tenantId),
      admin.from("journal_entries").select("id, source_type, source_id", { count: "exact" }).eq("tenant_id", tenantId).limit(LIMIT),
      admin.from("journal_lines").select("entry_id, account_id, debit, credit", { count: "exact" }).eq("tenant_id", tenantId).limit(LIMIT),
      admin.from("sales").select("id, subtotal, discount, tax, total, status").eq("tenant_id", tenantId).limit(LIMIT),
      admin.from("purchases").select("id, total, tax, status").eq("tenant_id", tenantId).limit(LIMIT),
      admin.from("payments").select("id, amount, status").eq("tenant_id", tenantId).limit(LIMIT),
      admin.from("customers").select("balance").eq("tenant_id", tenantId),
      admin.from("suppliers").select("balance").eq("tenant_id", tenantId),
    ]);

    const accounts = acc.data || [];
    const codeById = new Map(accounts.map((a) => [a.id as string, a.code as string]));
    const typeByCode = new Map(accounts.map((a) => [a.code as string, a.type as string]));
    const entries = ent.data || [];
    const lines = lns.data || [];

    if ((ent.count ?? 0) > LIMIT || (lns.count ?? 0) > LIMIT) {
      push("Functional", "Dataset size", "warn", `Large dataset — audit sampled the first ${LIMIT} entries/lines.`);
    }

    // Aggregate lines per entry and per account code.
    const byEntry = new Map<string, { d: number; c: number }>();
    const byCode = new Map<string, { d: number; c: number }>();
    let totalD = 0, totalC = 0;
    for (const l of lines) {
      const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      totalD += d; totalC += c;
      const e = byEntry.get(l.entry_id as string) || { d: 0, c: 0 }; e.d += d; e.c += c; byEntry.set(l.entry_id as string, e);
      const code = codeById.get(l.account_id as string) || "?";
      const a = byCode.get(code) || { d: 0, c: 0 }; a.d += d; a.c += c; byCode.set(code, a);
    }
    const bal = (code: string) => { const a = byCode.get(code) || { d: 0, c: 0 }; return a.d - a.c; }; // debit-positive

    // 1. Every journal entry is internally balanced.
    const unbalanced = [...byEntry.values()].filter((e) => Math.abs(e.d - e.c) > 0.01).length;
    push("Double-entry", "Every journal entry balances", unbalanced === 0 ? "pass" : "fail",
      unbalanced === 0 ? `All ${byEntry.size} entries balanced (debit = credit)` : `${unbalanced} entr(ies) where debit ≠ credit`);

    // 2. Trial balance.
    push("Double-entry", "Trial balance (Σ debit = Σ credit)", Math.abs(totalD - totalC) < 0.01 ? "pass" : "fail",
      `Σdr=${totalD.toFixed(2)}, Σcr=${totalC.toFixed(2)}, diff=${(totalD - totalC).toFixed(2)}`);

    // 3. Accounting equation by type (restatement; reassuring sanity).
    let assets = 0, liab = 0, equity = 0, income = 0, expense = 0;
    for (const [code, a] of byCode) {
      const t = typeByCode.get(code); const net = a.d - a.c;
      if (t === "asset") assets += net;
      else if (t === "liability") liab += -net;
      else if (t === "equity") equity += -net;
      else if (t === "income") income += -net;
      else if (t === "expense") expense += net;
    }
    const rhs = liab + equity + (income - expense);
    push("Balance sheet", "Accounting equation (Assets = Liabilities + Equity + P/L)", near(assets, rhs, 0.01) ? "pass" : "warn",
      `Assets=${assets.toFixed(2)} vs L+E+P/L=${rhs.toFixed(2)}`);

    // 4. Sales revenue (GL 4000) == Σ invoice net (subtotal − discount) for posted sales.
    const sales = sal.data || [];
    const postedSales = sales.filter((s) => s.status !== "draft" && s.status !== "cancelled");
    const expectedRevenue = postedSales.reduce((a, s) => a + (Number(s.subtotal) - Number(s.discount)), 0);
    const actualRevenue = -bal("4000");
    push("Sales", "Revenue posted matches invoices", near(expectedRevenue, actualRevenue) ? "pass" : "warn",
      `GL Sales(4000)=${actualRevenue.toFixed(2)} vs invoices net=${expectedRevenue.toFixed(2)} (${postedSales.length} sales)`);

    // 5. Every posted sale has a journal entry.
    const saleSources = new Set(entries.filter((e) => e.source_type === "sale").map((e) => e.source_id));
    const salesNoJournal = postedSales.filter((s) => !saleSources.has(s.id)).length;
    push("Sales", "Every posted sale has a journal", salesNoJournal === 0 ? "pass" : "warn",
      salesNoJournal === 0 ? `${postedSales.length} posted sales all journaled` : `${salesNoJournal} posted sale(s) missing a journal entry`);

    // 6. Purchases → inventory in (GL 1300 debits ≈ Σ received purchase net).
    const purchases = pur.data || [];
    const recvPurch = purchases.filter((p) => ["received", "paid"].includes(p.status as string));
    const expectedInvIn = recvPurch.reduce((a, p) => a + (Number(p.total) - Number(p.tax)), 0);
    const invDebits = (byCode.get("1300") || { d: 0 }).d;
    push("Purchases", "Inventory received matches purchases", invDebits + 0.0001 >= expectedInvIn - 0.5 ? "pass" : "warn",
      `GL Inventory(1300) debits=${invDebits.toFixed(2)} vs purchases net in=${expectedInvIn.toFixed(2)} (${recvPurch.length} received)`);

    // 7. AR control == Σ customer balances.
    const arSub = (cus.data || []).reduce((a, c) => a + Number(c.balance || 0), 0);
    push("Receivables", "AR control = Σ customer balances", near(arSub, bal("1200")) ? "pass" : "warn",
      `GL A/R(1200)=${bal("1200").toFixed(2)} vs Σ customer balances=${arSub.toFixed(2)}`);

    // 8. AP control == Σ supplier balances.
    const apSub = (sup.data || []).reduce((a, s) => a + Number(s.balance || 0), 0);
    push("Payables", "AP control = Σ supplier balances", near(apSub, -bal("2000")) ? "pass" : "warn",
      `GL A/P(2000)=${(-bal("2000")).toFixed(2)} vs Σ supplier balances=${apSub.toFixed(2)}`);

    // 9. Every (posted) payment has a journal entry.
    const payments = pay.data || [];
    const paySources = new Set(entries.filter((e) => e.source_type === "payment").map((e) => e.source_id));
    const payNoJournal = payments.filter((p) => !paySources.has(p.id)).length;
    push("Payments", "Every payment has a journal", payNoJournal === 0 ? "pass" : "warn",
      payNoJournal === 0 ? `${payments.length} payments all journaled` : `${payNoJournal} payment(s) without a journal (may be pending approval)`);

    if (out.length === 0) push("Functional", "No data", "pass", "Workspace has no transactions yet.");
  } catch (e) {
    push("Functional", "Audit error", "fail", e instanceof Error ? e.message : String(e));
  }
  return out;
}

export type UnitTestResult = { ok: boolean; available: boolean; output: string };

/** Run the Vitest unit suite (available where dev dependencies are installed). */
export async function runUnitTests(): Promise<UnitTestResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, available: false, output: "Not authorized." };
  try {
    const { stdout, stderr } = await exec("npx vitest run --reporter=basic", {
      cwd: process.cwd(),
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, CI: "true" },
    });
    return { ok: true, available: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
    const out = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
    if (/not found|is not recognized|ENOENT|vitest/i.test(err.message || "") && !out) {
      return { ok: false, available: false, output: "Vitest is not installed in this environment (it's a dev dependency). Run `npm test` locally / in CI." };
    }
    // A non-zero exit with output means tests ran but some failed.
    return { ok: false, available: true, output: out || err.message || "Test run failed." };
  }
}
