"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber } from "@/lib/numbering";
import {
  postJournal, resolvePaymentMethodAccountCode, ensureChartOfAccounts, assertSufficientFunds,
} from "@/lib/accounting";

type Result = { ok: boolean; error?: string };

const LOANS_PAYABLE = "2300";
const LOANS_RECEIVABLE = "1400";
const INTEREST_EXPENSE = "5900";
const INTEREST_INCOME = "4200";

async function reverseEntry(admin: ReturnType<typeof createServiceClient>, journal_entry_id: string | null, label: string, source_id: string) {
  if (!journal_entry_id) return;
  const { data: lines } = await admin.from("journal_lines")
    .select("account_id, debit, credit, description").eq("entry_id", journal_entry_id);
  if (!lines?.length) return;
  const reversal_no = await reserveNextNumber("nextJournal", "JE-");
  const { data: rev } = await admin.from("journal_entries").insert({
    entry_no: reversal_no, date: new Date().toISOString().slice(0, 10),
    description: `Reversal of ${label}`, source_type: "manual", source_id,
  }).select("id").single();
  if (!rev) return;
  await admin.from("journal_lines").insert(lines.map((l) => ({
    entry_id: rev.id, account_id: l.account_id,
    debit: Number(l.credit) || 0, credit: Number(l.debit) || 0,
    description: `Reversal: ${l.description ?? ""}`.trim(),
  })));
}

/* -------------------------------------------------------------------------- */
/* CREATE LOAN (origination)                                                   */
/* -------------------------------------------------------------------------- */
export async function createLoan(formData: FormData): Promise<Result> {
  try {
    await requirePermission("loans", "create");
    const direction = (String(formData.get("direction") || "payable") as "payable" | "receivable");
    const party_name = String(formData.get("party_name") || "").trim();
    if (!party_name) return { ok: false, error: direction === "payable" ? "Lender name required" : "Borrower name required" };
    const principal = Math.round((Number(formData.get("principal") || 0) || 0) * 100) / 100;
    if (principal <= 0) return { ok: false, error: "Principal must be greater than 0" };
    const interest_rate = Math.max(0, Number(formData.get("interest_rate") || 0) || 0);
    const start_date = String(formData.get("start_date") || new Date().toISOString().slice(0, 10));
    const due_date = String(formData.get("due_date") || "") || null;
    const payment_method_id = (String(formData.get("payment_method_id") || "") || null) as string | null;
    const notes = String(formData.get("notes") || "").trim() || null;

    const admin = createServiceClient();
    await ensureChartOfAccounts(admin);

    // Lending pays money OUT now — don't lend what you don't have.
    if (direction === "receivable") {
      const funds = await assertSufficientFunds(payment_method_id, principal, "the pay account");
      if (!funds.ok) return { ok: false, error: funds.error };
    }

    const assetCode = await resolvePaymentMethodAccountCode(admin, payment_method_id);
    const loan_no = await reserveNextNumber("nextLoan", "LN-");
    const { userId } = await getCurrentSession();

    const { data: loan, error: insErr } = await admin.from("loans").insert({
      loan_no, direction, party_name, principal, interest_rate, start_date, due_date,
      payment_method_id, status: "active", notes, created_by: userId,
    }).select("id").single();
    if (insErr || !loan) return { ok: false, error: insErr?.message || "Failed to create loan" };

    const lines = direction === "payable"
      ? [ // we borrowed → cash in, owe a liability
          { account_code: assetCode, debit: principal, description: `Borrowed from ${party_name}` },
          { account_code: LOANS_PAYABLE, credit: principal, description: `Loan from ${party_name}` },
        ]
      : [ // we lent → asset (receivable), cash out
          { account_code: LOANS_RECEIVABLE, debit: principal, description: `Lent to ${party_name}` },
          { account_code: assetCode, credit: principal, description: `Loan to ${party_name}` },
        ];
    const j = await postJournal({
      date: start_date,
      description: `${direction === "payable" ? "Borrowing" : "Lending"} ${loan_no} — ${party_name}`,
      source_type: "manual", source_id: loan.id, lines,
    });
    if (!j.ok) {
      await admin.from("loans").delete().eq("id", loan.id);
      return { ok: false, error: `Journal failed: ${j.error}` };
    }
    await admin.from("loans").update({ journal_entry_id: j.entry_id ?? null }).eq("id", loan.id);

    revalidatePath("/loans"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/* -------------------------------------------------------------------------- */
/* RECORD A REPAYMENT / RECEIPT (principal + interest split)                   */
/* -------------------------------------------------------------------------- */
export async function recordLoanPayment(formData: FormData): Promise<Result> {
  try {
    await requirePermission("loans", "create");
    const loan_id = String(formData.get("loan_id") || "");
    if (!loan_id) return { ok: false, error: "Loan is required" };
    const principal_portion = Math.max(0, Math.round((Number(formData.get("principal_portion") || 0) || 0) * 100) / 100);
    const interest_portion = Math.max(0, Math.round((Number(formData.get("interest_portion") || 0) || 0) * 100) / 100);
    const amount = Math.round((principal_portion + interest_portion) * 100) / 100;
    if (amount <= 0) return { ok: false, error: "Enter a principal and/or interest amount" };
    const date = String(formData.get("date") || new Date().toISOString().slice(0, 10));
    const payment_method_id = (String(formData.get("payment_method_id") || "") || null) as string | null;
    const notes = String(formData.get("notes") || "").trim() || null;

    const admin = createServiceClient();
    await ensureChartOfAccounts(admin);
    const { data: loan } = await admin.from("loans").select("*").eq("id", loan_id).single();
    if (!loan) return { ok: false, error: "Loan not found" };
    if (loan.status === "cancelled") return { ok: false, error: "Loan is cancelled" };

    // Repaying borrowing pays money OUT — fund check.
    if (loan.direction === "payable") {
      const funds = await assertSufficientFunds(payment_method_id, amount, "the pay account");
      if (!funds.ok) return { ok: false, error: funds.error };
    }

    const assetCode = await resolvePaymentMethodAccountCode(admin, payment_method_id);
    const payment_no = await reserveNextNumber("nextLoanPayment", "LP-");
    const { userId } = await getCurrentSession();

    const { data: pay, error: insErr } = await admin.from("loan_payments").insert({
      payment_no, loan_id, date, amount, principal_portion, interest_portion,
      payment_method_id, status: "posted", notes, created_by: userId,
    }).select("id").single();
    if (insErr || !pay) return { ok: false, error: insErr?.message || "Failed to record" };

    const lines = loan.direction === "payable"
      ? [ // we pay back: reduce liability + interest expense, cash out
          ...(principal_portion > 0 ? [{ account_code: LOANS_PAYABLE, debit: principal_portion, description: `Principal ${loan.loan_no}` }] : []),
          ...(interest_portion > 0 ? [{ account_code: INTEREST_EXPENSE, debit: interest_portion, description: `Interest ${loan.loan_no}` }] : []),
          { account_code: assetCode, credit: amount, description: `Repayment to ${loan.party_name}` },
        ]
      : [ // borrower pays us: cash in, reduce receivable + interest income
          { account_code: assetCode, debit: amount, description: `Receipt from ${loan.party_name}` },
          ...(principal_portion > 0 ? [{ account_code: LOANS_RECEIVABLE, credit: principal_portion, description: `Principal ${loan.loan_no}` }] : []),
          ...(interest_portion > 0 ? [{ account_code: INTEREST_INCOME, credit: interest_portion, description: `Interest ${loan.loan_no}` }] : []),
        ];
    const j = await postJournal({
      date, description: `Loan ${loan.direction === "payable" ? "repayment" : "receipt"} ${payment_no} — ${loan.party_name}`,
      source_type: "manual", source_id: pay.id, lines,
    });
    if (!j.ok) {
      await admin.from("loan_payments").delete().eq("id", pay.id);
      return { ok: false, error: `Journal failed: ${j.error}` };
    }
    await admin.from("loan_payments").update({ journal_entry_id: j.entry_id ?? null }).eq("id", pay.id);

    // Mark settled once principal is fully repaid.
    await refreshLoanStatus(admin, loan_id);

    revalidatePath("/loans"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

async function refreshLoanStatus(admin: ReturnType<typeof createServiceClient>, loan_id: string) {
  const { data: loan } = await admin.from("loans").select("principal, status").eq("id", loan_id).single();
  if (!loan || loan.status === "cancelled") return;
  const { data: pays } = await admin.from("loan_payments")
    .select("principal_portion").eq("loan_id", loan_id).neq("status", "cancelled");
  const paidPrincipal = (pays || []).reduce((s, p) => s + Number(p.principal_portion || 0), 0);
  const next = paidPrincipal >= Number(loan.principal) - 0.01 ? "settled" : "active";
  await admin.from("loans").update({ status: next }).eq("id", loan_id);
}

export async function cancelLoanPayment(id: string): Promise<Result> {
  try {
    await requirePermission("loans", "edit");
    const admin = createServiceClient();
    const { data: p } = await admin.from("loan_payments").select("*").eq("id", id).single();
    if (!p) return { ok: false, error: "Not found" };
    if (p.status === "cancelled") return { ok: false, error: "Already cancelled" };
    await reverseEntry(admin, p.journal_entry_id, `loan payment ${p.payment_no}`, id);
    await admin.from("loan_payments").update({ status: "cancelled" }).eq("id", id);
    await refreshLoanStatus(admin, p.loan_id);
    revalidatePath("/loans"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function cancelLoan(id: string): Promise<Result> {
  try {
    await requirePermission("loans", "edit");
    const admin = createServiceClient();
    const { data: loan } = await admin.from("loans").select("*").eq("id", id).single();
    if (!loan) return { ok: false, error: "Not found" };
    if (loan.status === "cancelled") return { ok: false, error: "Already cancelled" };
    // Reverse all non-cancelled repayments, then the origination.
    const { data: pays } = await admin.from("loan_payments").select("id, journal_entry_id, payment_no, status").eq("loan_id", id);
    for (const p of pays || []) {
      if (p.status === "cancelled") continue;
      await reverseEntry(admin, p.journal_entry_id, `loan payment ${p.payment_no}`, p.id);
      await admin.from("loan_payments").update({ status: "cancelled" }).eq("id", p.id);
    }
    await reverseEntry(admin, loan.journal_entry_id, `loan ${loan.loan_no}`, id);
    await admin.from("loans").update({ status: "cancelled" }).eq("id", id);
    revalidatePath("/loans"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
