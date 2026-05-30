"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber } from "@/lib/numbering";
import { postJournal, ensureChartOfAccounts, assertSufficientFunds } from "@/lib/accounting";

type Result = { ok: boolean; error?: string; salary_payment_id?: string };
type RunResult = { ok: boolean; error?: string; run_id?: string };

const today = () => new Date().toISOString().slice(0, 10);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ========================================================================== */
/* SHARED HELPERS                                                              */
/* ========================================================================== */

/**
 * Resolve the asset (Cr) account for a salary payment based on the
 * payment method selected. Mirrors the logic in lib/accounting.ts.
 */
async function resolveAssetCodeForPaymentMethod(
  admin: ReturnType<typeof createServiceClient>,
  payment_method_id: string | null
): Promise<string> {
  if (!payment_method_id) return "1010"; // default to cash drawer
  const { data: pm } = await admin
    .from("payment_methods")
    .select("kind, bank_account_id")
    .eq("id", payment_method_id)
    .single();
  if (!pm) return "1010";
  if (pm.kind === "cash") return "1010";
  if (pm.kind === "mpesa") return "1110";
  if (pm.kind === "card") return "1100";
  if (pm.kind === "bank") {
    if (pm.bank_account_id) {
      const { data: ba } = await admin
        .from("bank_accounts")
        .select("account_id").eq("id", pm.bank_account_id).single();
      if (ba?.account_id) {
        const { data: acc } = await admin
          .from("accounts").select("code").eq("id", ba.account_id).single();
        if (acc?.code) return acc.code;
      }
    }
    return "1100";
  }
  return "1010";
}

type SalaryAmounts = {
  base_salary: number;
  commission: number;
  bonus: number;
  deductions: number;
  net: number;
};

/**
 * Build the balanced double-entry lines for one salary payment.
 *
 *   Dr Salaries Expense (5100)   base_salary
 *   Dr Commission Expense (5150) commission   (if > 0)
 *   Dr Bonus Expense (5160)      bonus        (if > 0)
 *      Cr <asset based on payment method>     net  (= gross − deductions)
 *
 * Deductions aren't modelled as a separate payable yet, so they're netted
 * against the expense debits (record net expense, not gross).
 */
function buildSalaryJournalLines(
  emp: { code: string },
  a: SalaryAmounts,
  assetCode: string
) {
  const lines: { account_code: string; debit?: number; credit?: number; description?: string }[] = [];
  if (a.base_salary > 0) lines.push({ account_code: "5100", debit: a.base_salary, description: `Salary ${emp.code}` });
  if (a.commission > 0) lines.push({ account_code: "5150", debit: a.commission, description: `Commission ${emp.code}` });
  if (a.bonus > 0) lines.push({ account_code: "5160", debit: a.bonus, description: `Bonus ${emp.code}` });

  if (a.deductions > 0) {
    const salaryLine = lines.find((l) => l.account_code === "5100");
    if (salaryLine && salaryLine.debit) {
      salaryLine.debit = round2(salaryLine.debit - a.deductions);
      if (salaryLine.debit < 0) {
        // Deductions exceed base salary — spill into commission then bonus.
        let remaining = -salaryLine.debit;
        salaryLine.debit = 0;
        for (const code of ["5150", "5160"] as const) {
          if (remaining <= 0) break;
          const l = lines.find((x) => x.account_code === code);
          if (!l || !l.debit) continue;
          const take = Math.min(remaining, l.debit);
          l.debit = round2(l.debit - take);
          remaining -= take;
        }
      }
    }
  }
  lines.push({ account_code: assetCode, credit: a.net, description: `Net pay to ${emp.code}` });
  return lines;
}

type PostableLine = SalaryAmounts & {
  id: string;
  payment_no: string;
  employee_id: string;
  pay_date: string;
  payment_method_id: string | null;
};

/**
 * Post the double-entry journal for a single (draft) salary payment row.
 * Does NOT mutate the salary_payments status — the caller decides that so it
 * can roll back on failure. Returns the new journal entry id.
 */
async function postSalaryPaymentJournal(
  admin: ReturnType<typeof createServiceClient>,
  sp: PostableLine
): Promise<{ ok: boolean; error?: string; entry_id?: string }> {
  const assetCode = await resolveAssetCodeForPaymentMethod(admin, sp.payment_method_id);
  const requiredCodes = [assetCode, "5100"];
  if (sp.commission > 0) requiredCodes.push("5150");
  if (sp.bonus > 0) requiredCodes.push("5160");
  // Auto-create the standard chart of accounts if needed, then re-check.
  await ensureChartOfAccounts(admin);
  const { data: accs } = await admin.from("accounts").select("code").in("code", requiredCodes);
  const have = new Set((accs || []).map((a) => a.code));
  const missing = requiredCodes.filter((c) => !have.has(c));
  if (missing.length) {
    return {
      ok: false,
      error: `Chart of accounts is missing required code(s): ${missing.join(", ")}. ` +
             `Add the payment method's bank account under Chart of Accounts.`,
    };
  }

  const { data: emp } = await admin
    .from("employees").select("full_name, code").eq("id", sp.employee_id).single();
  if (!emp) return { ok: false, error: "Employee not found" };

  // Don't pay salary from an account that doesn't hold the net amount.
  const funds = await assertSufficientFunds(sp.payment_method_id, sp.net, "the pay account");
  if (!funds.ok) return { ok: false, error: funds.error };

  const lines = buildSalaryJournalLines(emp, sp, assetCode);
  const j = await postJournal({
    date: sp.pay_date,
    description: `Payroll ${sp.payment_no} — ${emp.full_name}`,
    source_type: "manual",
    source_id: sp.id,
    lines,
  });
  if (!j.ok) return { ok: false, error: j.error };
  return { ok: true, entry_id: j.entry_id ?? undefined };
}

/**
 * Post a reversing journal for a previously-posted salary payment so the
 * ledger stays balanced and the original run remains auditable.
 */
async function reverseSalaryPaymentJournal(
  admin: ReturnType<typeof createServiceClient>,
  sp: { journal_entry_id: string | null; payment_no: string; id: string }
): Promise<void> {
  if (!sp.journal_entry_id) return;
  const { data: lines } = await admin.from("journal_lines")
    .select("account_id, debit, credit, description").eq("entry_id", sp.journal_entry_id);
  if (!lines || !lines.length) return;
  const reversal_no = await reserveNextNumber("nextJournal", "JE-");
  const { data: rev } = await admin
    .from("journal_entries").insert({
      entry_no: reversal_no,
      date: today(),
      description: `Reversal of payroll ${sp.payment_no}`,
      source_type: "manual",
      source_id: sp.id,
    })
    .select("id").single();
  if (!rev) return;
  await admin.from("journal_lines").insert(
    lines.map((l) => ({
      entry_id: rev.id,
      account_id: l.account_id,
      debit: Number(l.credit) || 0,
      credit: Number(l.debit) || 0,
      description: `Reversal: ${l.description ?? ""}`.trim(),
    }))
  );
}

/**
 * Recompute a payroll run's roll-up totals from its non-cancelled lines.
 */
async function refreshRunTotals(
  admin: ReturnType<typeof createServiceClient>,
  run_id: string
): Promise<void> {
  const { data: rows } = await admin
    .from("salary_payments")
    .select("gross, deductions, net")
    .eq("run_id", run_id)
    .neq("status", "cancelled");
  const t = (rows || []).reduce(
    (acc, r) => ({
      gross: acc.gross + (Number(r.gross) || 0),
      deductions: acc.deductions + (Number(r.deductions) || 0),
      net: acc.net + (Number(r.net) || 0),
    }),
    { gross: 0, deductions: 0, net: 0 }
  );
  await admin
    .from("payroll_runs")
    .update({
      total_gross: round2(t.gross),
      total_deductions: round2(t.deductions),
      total_net: round2(t.net),
    })
    .eq("id", run_id);
}

function revalidatePayrollViews() {
  revalidatePath("/payroll");
  revalidatePath("/employees");
  revalidatePath("/journal");
  revalidatePath("/reports");
  revalidatePath("/bank-accounts");
}

/* ========================================================================== */
/* PAYROLL RUN LIFECYCLE                                                       */
/* ========================================================================== */

/**
 * Start a payroll run for a completed pay period and stage one draft salary
 * line per selected active employee (using their default base salary + pay
 * method). Lines stay `draft` until the run is approved and paid.
 *
 * Requires the `payroll/create` ("run payroll") permission.
 *
 * Guards:
 *   * Period must be complete — cannot open a run for a period that hasn't
 *     ended yet (period_end in the future).
 *   * Only one active (non-cancelled) run per exact period.
 *   * Employees already paid (a non-cancelled line) for the period are skipped.
 */
export async function createPayrollRun(formData: FormData): Promise<RunResult> {
  try {
    await requirePermission("payroll", "create");
    const period_start = String(formData.get("period_start") || "");
    const period_end   = String(formData.get("period_end") || "");
    const pay_date     = String(formData.get("pay_date") || today());
    const notes        = String(formData.get("notes") || "") || null;

    let employee_ids: string[] = [];
    try { employee_ids = JSON.parse(String(formData.get("employee_ids") || "[]")); } catch {}
    employee_ids = [...new Set(employee_ids.filter(Boolean))];

    if (!period_start || !period_end) return { ok: false, error: "Pay period is required" };
    if (period_end < period_start) return { ok: false, error: "Period end cannot be before period start" };
    if (period_end > today()) {
      return { ok: false, error: "You cannot start a payroll run for a period that hasn't ended yet." };
    }
    if (!employee_ids.length) return { ok: false, error: "Select at least one employee" };

    const admin = createServiceClient();

    // One active run per period.
    const { data: existing } = await admin
      .from("payroll_runs")
      .select("id, run_no")
      .eq("period_start", period_start)
      .eq("period_end", period_end)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { ok: false, error: `A payroll run (${existing.run_no}) already exists for this period.` };
    }

    // Resolve the selected, still-active employees.
    const { data: emps } = await admin
      .from("employees")
      .select("id, code, base_salary, payment_method_id")
      .in("id", employee_ids)
      .eq("status", "active");
    if (!emps || !emps.length) return { ok: false, error: "No active employees selected" };

    // Drop anyone already paid for this exact period.
    const { data: paidRows } = await admin
      .from("salary_payments")
      .select("employee_id")
      .in("employee_id", emps.map((e) => e.id))
      .eq("period_start", period_start)
      .eq("period_end", period_end)
      .neq("status", "cancelled");
    const paid = new Set((paidRows || []).map((r) => r.employee_id));
    const eligible = emps.filter((e) => !paid.has(e.id) && Number(e.base_salary) > 0);
    if (!eligible.length) {
      return { ok: false, error: "No eligible employees — all selected are already paid for this period or have no base salary." };
    }

    const run_no = await reserveNextNumber("nextPayrollRun", "PR-");
    const { userId } = await getCurrentSession();
    const { data: run, error: runErr } = await admin
      .from("payroll_runs")
      .insert({
        run_no, period_start, period_end, pay_date,
        status: "draft", notes, created_by: userId,
      })
      .select("id")
      .single();
    if (runErr || !run) return { ok: false, error: runErr?.message || "Failed to start payroll run" };

    // Stage a draft line per eligible employee.
    for (const e of eligible) {
      const base_salary = round2(Number(e.base_salary) || 0);
      const payment_no = await reserveNextNumber("nextSalaryPayment", "SAL-");
      await admin.from("salary_payments").insert({
        payment_no,
        employee_id: e.id,
        period_start, period_end, pay_date,
        base_salary,
        commission: 0,
        bonus: 0,
        deductions: 0,
        gross: base_salary,
        net: base_salary,
        payment_method_id: e.payment_method_id,
        run_id: run.id,
        status: "draft",
        created_by: userId,
      });
    }

    await refreshRunTotals(admin, run.id);
    revalidatePayrollViews();
    return { ok: true, run_id: run.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Approve a draft payroll run (manager sign-off). Requires `payroll/approve`.
 */
export async function approvePayrollRun(runId: string): Promise<RunResult> {
  try {
    await requirePermission("payroll", "approve");
    const admin = createServiceClient();
    const { data: run } = await admin.from("payroll_runs").select("status").eq("id", runId).single();
    if (!run) return { ok: false, error: "Payroll run not found" };
    if (run.status !== "draft") return { ok: false, error: `Only draft runs can be approved (this one is ${run.status}).` };

    const { userId } = await getCurrentSession();
    await admin.from("payroll_runs")
      .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
      .eq("id", runId);
    revalidatePath("/payroll");
    return { ok: true, run_id: runId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Pay (post) an approved payroll run — posts each draft line's journal and
 * marks the run posted. Requires `payroll/post` ("pay") permission.
 *
 * Already-posted lines are skipped, so a partially-failed run can be retried.
 */
export async function payPayrollRun(runId: string): Promise<RunResult> {
  try {
    await requirePermission("payroll", "post");
    const admin = createServiceClient();
    const { data: run } = await admin.from("payroll_runs").select("*").eq("id", runId).single();
    if (!run) return { ok: false, error: "Payroll run not found" };
    if (run.status !== "approved") {
      return { ok: false, error: `Only approved runs can be paid (this one is ${run.status}). Approve it first.` };
    }
    if (run.period_end > today()) {
      return { ok: false, error: "You cannot pay for a period that hasn't ended yet." };
    }

    const { data: lines } = await admin
      .from("salary_payments")
      .select("id, payment_no, employee_id, pay_date, base_salary, commission, bonus, deductions, net, payment_method_id, status")
      .eq("run_id", runId);

    const failures: string[] = [];
    for (const sp of lines || []) {
      if (sp.status !== "draft") continue; // already posted / cancelled
      const j = await postSalaryPaymentJournal(admin, sp as PostableLine);
      if (!j.ok) { failures.push(`${sp.payment_no}: ${j.error}`); continue; }
      await admin.from("salary_payments")
        .update({ status: "posted", journal_entry_id: j.entry_id ?? null })
        .eq("id", sp.id);
    }

    await refreshRunTotals(admin, runId);

    if (failures.length) {
      revalidatePayrollViews();
      return { ok: false, error: `Some lines could not be paid:\n${failures.join("\n")}` };
    }

    const { userId } = await getCurrentSession();
    await admin.from("payroll_runs")
      .update({ status: "posted", posted_by: userId, posted_at: new Date().toISOString() })
      .eq("id", runId);

    revalidatePayrollViews();
    return { ok: true, run_id: runId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Cancel a payroll run. Posted lines get a reversing journal; draft/approved
 * lines are simply marked cancelled. Requires `payroll/edit`.
 */
export async function cancelPayrollRun(runId: string): Promise<RunResult> {
  try {
    await requirePermission("payroll", "edit");
    const admin = createServiceClient();
    const { data: run } = await admin.from("payroll_runs").select("status").eq("id", runId).single();
    if (!run) return { ok: false, error: "Payroll run not found" };
    if (run.status === "cancelled") return { ok: false, error: "Already cancelled" };

    const { data: lines } = await admin
      .from("salary_payments")
      .select("id, payment_no, journal_entry_id, status")
      .eq("run_id", runId);

    for (const sp of lines || []) {
      if (sp.status === "cancelled") continue;
      if (sp.status === "posted") {
        await reverseSalaryPaymentJournal(admin, sp);
      }
      await admin.from("salary_payments").update({ status: "cancelled" }).eq("id", sp.id);
    }

    await admin.from("payroll_runs").update({ status: "cancelled" }).eq("id", runId);
    await refreshRunTotals(admin, runId);
    revalidatePayrollViews();
    return { ok: true, run_id: runId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ========================================================================== */
/* SINGLE (AD-HOC) SALARY PAYMENT                                              */
/* ========================================================================== */

/**
 * Create + immediately post a single salary payment. This disburses money, so
 * it requires the `payroll/post` ("pay") permission. A payroll run must
 * already cover the period, and the same employee can't be paid twice for it.
 */
export async function createSalaryPayment(formData: FormData): Promise<Result> {
  try {
    await requirePermission("payroll", "post");
    const num = (k: string) => Math.max(0, Number(formData.get(k) || 0) || 0);
    const employee_id = String(formData.get("employee_id") || "");
    if (!employee_id) return { ok: false, error: "Employee is required" };
    const period_start = String(formData.get("period_start") || "");
    const period_end   = String(formData.get("period_end") || "");
    const pay_date     = String(formData.get("pay_date") || today());
    if (!period_start || !period_end) return { ok: false, error: "Pay period is required" };
    if (period_end < period_start) return { ok: false, error: "Period end cannot be before period start" };
    if (period_end > today()) {
      return { ok: false, error: "You cannot pay for a period that hasn't ended yet." };
    }

    const base_salary = num("base_salary");
    const commission  = num("commission");
    const bonus       = num("bonus");
    const deductions  = num("deductions");
    const gross       = round2(base_salary + commission + bonus);
    const net         = round2(gross - deductions);
    if (gross <= 0) return { ok: false, error: "Gross pay must be greater than 0" };
    if (net < 0)    return { ok: false, error: "Deductions cannot exceed gross" };

    const payment_method_id = (String(formData.get("payment_method_id") || "") || null) as string | null;
    const notes = String(formData.get("notes") || "") || null;

    const admin = createServiceClient();

    // A payroll run must already be open for this period.
    const { data: run } = await admin
      .from("payroll_runs")
      .select("id")
      .lte("period_start", period_start)
      .gte("period_end", period_end)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run) {
      return { ok: false, error: "No active payroll run covers this period. Start a payroll run first." };
    }

    // No paying the same employee twice for the same period.
    const { data: dup } = await admin
      .from("salary_payments")
      .select("payment_no")
      .eq("employee_id", employee_id)
      .eq("period_start", period_start)
      .eq("period_end", period_end)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    if (dup) {
      return { ok: false, error: `This employee has already been paid for this period (${dup.payment_no}).` };
    }

    const payment_no = await reserveNextNumber("nextSalaryPayment", "SAL-");
    const { userId } = await getCurrentSession();
    const { data: sp, error: spErr } = await admin
      .from("salary_payments")
      .insert({
        payment_no, employee_id, period_start, period_end, pay_date,
        base_salary, commission, bonus, deductions, gross, net,
        payment_method_id, run_id: run.id, status: "draft", notes, created_by: userId,
      })
      .select("id")
      .single();
    if (spErr || !sp) return { ok: false, error: spErr?.message || "Failed to create salary payment" };

    const j = await postSalaryPaymentJournal(admin, {
      id: sp.id, payment_no, employee_id, pay_date,
      base_salary, commission, bonus, deductions, net, payment_method_id,
    });
    if (!j.ok) {
      await admin.from("salary_payments").delete().eq("id", sp.id);
      return { ok: false, error: `Salary payment journal failed: ${j.error}` };
    }

    await admin
      .from("salary_payments")
      .update({ status: "posted", journal_entry_id: j.entry_id ?? null })
      .eq("id", sp.id);

    await refreshRunTotals(admin, run.id);
    revalidatePayrollViews();
    return { ok: true, salary_payment_id: sp.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Cancel + reverse a single salary payment. Requires `payroll/edit`.
 */
export async function cancelSalaryPayment(id: string): Promise<Result> {
  try {
    await requirePermission("payroll", "edit");
    const admin = createServiceClient();
    const { data: sp } = await admin.from("salary_payments").select("*").eq("id", id).single();
    if (!sp) return { ok: false, error: "Salary payment not found" };
    if (sp.status === "cancelled") return { ok: false, error: "Already cancelled" };

    await reverseSalaryPaymentJournal(admin, sp);
    await admin.from("salary_payments").update({ status: "cancelled" }).eq("id", id);
    if (sp.run_id) await refreshRunTotals(admin, sp.run_id);
    revalidatePath("/payroll");
    revalidatePath("/journal");
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
