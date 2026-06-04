"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import { postPaymentJournal, postJournal, recomputeSaleStatus, recomputePurchaseStatus, reverseJournalsForSource, assertSufficientFunds } from "@/lib/accounting";
import type { PaymentDirection, PaymentSource } from "@/lib/types";

type Result = { ok: boolean; error?: string };
type LineInput = { account_code: string; debit?: number; credit?: number; description?: string };

/** Number of approval levels a money-out amount needs (count of tiers met). */
async function approvalLevelsFor(amount: number): Promise<number> {
  const cfg = await getSettings();
  const tiers = (cfg.approvals?.tiers || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return tiers.filter((t) => amount >= t - 0.01).length;
}

/**
 * For an already-inserted money-out payment row, either post its journal now
 * (fund-checked) or hold it for approval if the amount needs sign-off.
 */
async function postOrQueueOut(
  admin: ReturnType<typeof createServiceClient>,
  payment: { id: string; date: string; amount: number; payment_method_id: string | null },
  lines: LineInput[],
  desc: string,
  fundAmount?: number,
): Promise<Result> {
  // Cash actually leaving = amount + any fee (the lines already encode the fee).
  const checkAmount = fundAmount ?? payment.amount;
  const levels = await approvalLevelsFor(payment.amount);
  if (levels <= 0) {
    const funds = await assertSufficientFunds(payment.payment_method_id, checkAmount);
    if (!funds.ok) { await admin.from("payments").delete().eq("id", payment.id); return { ok: false, error: funds.error }; }
    const j = await postJournal({ date: payment.date, description: desc, source_type: "payment", source_id: payment.id, lines });
    if (!j.ok) { await admin.from("payments").delete().eq("id", payment.id); return { ok: false, error: j.error }; }
    return { ok: true };
  }
  // Hold for approval — store the journal to post once signed off.
  await admin.from("payments").update({
    approval_status: "pending", required_levels: levels, pending_lines: lines, pending_desc: desc,
  }).eq("id", payment.id);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* APPROVAL ACTIONS                                                            */
/* -------------------------------------------------------------------------- */
export async function approvePayment(id: string): Promise<Result> {
  try {
    await requirePermission("payments", "approve");
    const admin = createServiceClient();
    const { userId, profile } = await getCurrentSession();
    const { data: p } = await admin.from("payments").select("*").eq("id", id).single();
    if (!p) return { ok: false, error: "Payment not found" };
    if (p.approval_status !== "pending") return { ok: false, error: "Not pending approval" };

    const approvals: { user_id: string; name: string; at: string }[] = Array.isArray(p.approvals) ? p.approvals : [];
    if (approvals.some((a) => a.user_id === userId)) return { ok: false, error: "You have already approved this payment" };
    approvals.push({ user_id: userId, name: profile.full_name || profile.username || profile.email || "user", at: new Date().toISOString() });

    if (approvals.length >= Number(p.required_levels || 1)) {
      // Fully approved → post the held journal now (fund-checked, incl. any fee).
      const funds = await assertSufficientFunds(p.payment_method_id, Number(p.amount) + Number(p.fee || 0));
      if (!funds.ok) return { ok: false, error: funds.error };
      const j = await postJournal({
        date: p.date, description: p.pending_desc || `Payment ${p.payment_no}`,
        source_type: "payment", source_id: p.id, lines: p.pending_lines || [],
      });
      if (!j.ok) return { ok: false, error: `Journal failed: ${j.error}` };
      await admin.from("payments").update({ approval_status: "approved", approvals, pending_lines: null }).eq("id", id);
    } else {
      await admin.from("payments").update({ approvals }).eq("id", id);
    }
    revalidatePath("/payments");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function rejectPayment(id: string): Promise<Result> {
  try {
    await requirePermission("payments", "approve");
    const admin = createServiceClient();
    const { data: p } = await admin.from("payments").select("approval_status").eq("id", id).single();
    if (!p) return { ok: false, error: "Payment not found" };
    if (p.approval_status !== "pending") return { ok: false, error: "Not pending approval" };
    await admin.from("payments").update({ approval_status: "rejected", pending_lines: null }).eq("id", id);
    revalidatePath("/payments");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function recordPayment(input: {
  direction: PaymentDirection;
  source_type: PaymentSource;
  sale_id?: string | null;
  purchase_id?: string | null;
  customer_id?: string | null;
  supplier_id?: string | null;
  payment_method_id: string;
  amount: number;
  fee?: number;
  reference?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };
    const fee = Math.max(0, Number(input.fee || 0) || 0);
    if (input.direction === "in" && fee >= input.amount) {
      return { ok: false, error: "Fee cannot be greater than or equal to the amount received." };
    }

    const supabase = await createClient();
    const admin = createServiceClient();
    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const payload = {
      payment_no,
      date: input.date || new Date().toISOString().slice(0, 10),
      direction: input.direction,
      source_type: input.source_type,
      sale_id: input.sale_id ?? null,
      purchase_id: input.purchase_id ?? null,
      customer_id: input.customer_id ?? null,
      supplier_id: input.supplier_id ?? null,
      payment_method_id: input.payment_method_id,
      amount: input.amount,
      fee,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    };
    const { data: created, error } = await supabase.from("payments").insert(payload).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed to record payment" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    if (input.direction === "out") {
      // Money out is fund-checked (incl. fee) & may be held for tiered approval.
      const lines: LineInput[] = [
        { account_code: "2000", debit: input.amount, description: `Payment ${payment_no}` },
        ...(fee > 0 ? [{ account_code: "5200", debit: fee, description: `Charges on ${payment_no}` }] : []),
        { account_code: asset,  credit: input.amount + fee, description: `Outflow for ${payment_no}` },
      ];
      const r = await postOrQueueOut(admin, created, lines, `Payment to supplier ${payment_no}`, input.amount + fee);
      if (!r.ok) return r;
    } else if (fee > 0) {
      // Money in, net of a deducted fee: Dr asset (amount−fee) · Dr Charges · Cr A/R.
      const j = await postJournal({
        date: created.date, description: `Receipt ${payment_no}`, source_type: "payment", source_id: created.id,
        lines: [
          { account_code: asset,   debit: input.amount - fee, description: `Receipt ${payment_no}` },
          { account_code: "5200",  debit: fee,                description: `Charges on ${payment_no}` },
          { account_code: "1200",  credit: input.amount,      description: `Receipt for ${payment_no}` },
        ],
      });
      if (!j.ok) return { ok: false, error: j.error };
    } else {
      await postPaymentJournal(created);
    }
    // recompute* ignores pending/rejected payments, so a held payment won't
    // mark the sale/purchase paid until it's actually approved & posted.
    if (input.sale_id) await recomputeSaleStatus(input.sale_id);
    if (input.purchase_id) await recomputePurchaseStatus(input.purchase_id);

    revalidatePath("/payments");
    revalidatePath("/sales");
    revalidatePath("/purchases");
    return { ok: true, payment_no };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Resolve the chart-of-accounts code (e.g. "1010", "1110", "1100") for the
 * cash / bank / mpesa asset that backs a payment method.
 */
async function assetCodeForMethod(payment_method_id: string): Promise<string> {
  const admin = createServiceClient();
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
      const { data: ba } = await admin.from("bank_accounts").select("account_id").eq("id", pm.bank_account_id).single();
      if (ba?.account_id) {
        const { data: acc } = await admin.from("accounts").select("code").eq("id", ba.account_id).single();
        if (acc?.code) return acc.code;
      }
    }
    return "1100";
  }
  return "1010";
}

/**
 * NEW RECEIPT - "Customer Deposit"
 *
 * Customer hands over money against a future sale or as a balance top-up,
 * not yet tied to any specific invoice. Posts:
 *   Dr Cash / Bank      [amount]
 *      Cr Customer Advances (2200)   [amount]
 */
export async function recordCustomerDeposit(input: {
  customer_id: string;
  amount: number;
  payment_method_id: string;
  fee?: number;
  reference?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.customer_id) return { ok: false, error: "Customer is required" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };
    const fee = Math.max(0, Number(input.fee || 0) || 0);
    if (fee >= input.amount) return { ok: false, error: "Fee cannot be greater than or equal to the amount." };

    const supabase = await createClient();
    const admin = createServiceClient();
    const { data: cust } = await admin.from("customers").select("name").eq("id", input.customer_id).single();
    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const { data: created, error } = await supabase.from("payments").insert({
      payment_no,
      date: input.date || new Date().toISOString().slice(0, 10),
      direction: "in",
      source_type: "other",
      customer_id: input.customer_id,
      payment_method_id: input.payment_method_id,
      amount: input.amount,
      fee,
      reference: input.reference ?? null,
      notes: input.notes || `Customer deposit · ${cust?.name ?? ""}`.trim(),
    }).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    await postJournal({
      date: created.date,
      description: `Receipt ${payment_no} - Customer deposit`,
      source_type: "payment",
      source_id: created.id,
      lines: [
        { account_code: asset, debit: input.amount - fee, description: `Deposit from ${cust?.name ?? "customer"}` },
        ...(fee > 0 ? [{ account_code: "5200", debit: fee, description: `Charges on ${payment_no}` }] : []),
        { account_code: "2200", credit: input.amount, description: `Advance from ${cust?.name ?? "customer"}` },
      ],
    });

    revalidatePath("/receipts");
    revalidatePath("/payments");
    return { ok: true, payment_no };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * NEW RECEIPT - "Other Income"
 *
 * Non-sales money in: refunds, interest, asset sale, commissions. Posts:
 *   Dr Cash / Bank          [amount]
 *      Cr <income_account>  [amount]    (defaults to 4100 Other Income)
 */
export async function recordOtherIncome(input: {
  amount: number;
  income_account_code?: string;
  payment_method_id: string;
  description: string;
  fee?: number;
  reference?: string | null;
  date?: string;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };
    if (!input.description.trim()) return { ok: false, error: "Describe what the income is for" };
    const fee = Math.max(0, Number(input.fee || 0) || 0);
    if (fee >= input.amount) return { ok: false, error: "Fee cannot be greater than or equal to the amount." };

    const supabase = await createClient();
    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const incomeCode = input.income_account_code || "4100";
    const { data: created, error } = await supabase.from("payments").insert({
      payment_no,
      date: input.date || new Date().toISOString().slice(0, 10),
      direction: "in",
      source_type: "other",
      payment_method_id: input.payment_method_id,
      amount: input.amount,
      fee,
      reference: input.reference ?? null,
      notes: `Other income · ${input.description}`,
    }).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    await postJournal({
      date: created.date,
      description: `Receipt ${payment_no} - ${input.description}`,
      source_type: "payment",
      source_id: created.id,
      lines: [
        { account_code: asset,      debit:  input.amount - fee, description: input.description },
        ...(fee > 0 ? [{ account_code: "5200", debit: fee, description: `Charges on ${payment_no}` }] : []),
        { account_code: incomeCode, credit: input.amount, description: input.description },
      ],
    });

    revalidatePath("/receipts");
    revalidatePath("/payments");
    return { ok: true, payment_no };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * NEW PAYMENT - "Operating Expense"
 *
 * Rent, salaries, utilities, etc. Posts:
 *   Dr <expense_account>     [amount]
 *      Cr Cash / Bank        [amount]
 */
export async function recordExpense(input: {
  amount: number;
  expense_account_code: string;
  payment_method_id: string;
  description: string;
  fee?: number;
  reference?: string | null;
  supplier_id?: string | null;
  date?: string;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };
    if (!input.expense_account_code) return { ok: false, error: "Expense account is required" };
    if (!input.description.trim()) return { ok: false, error: "Describe the expense" };
    const fee = Math.max(0, Number(input.fee || 0) || 0);

    const supabase = await createClient();
    const admin = createServiceClient();
    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const { data: created, error } = await supabase.from("payments").insert({
      payment_no,
      date: input.date || new Date().toISOString().slice(0, 10),
      direction: "out",
      source_type: "other",
      supplier_id: input.supplier_id ?? null,
      payment_method_id: input.payment_method_id,
      amount: input.amount,
      fee,
      reference: input.reference ?? null,
      notes: `Expense · ${input.description}`,
    }).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    const lines: LineInput[] = [
      { account_code: input.expense_account_code, debit:  input.amount, description: input.description },
      ...(fee > 0 ? [{ account_code: "5200", debit: fee, description: `Charges on ${payment_no}` }] : []),
      { account_code: asset,                       credit: input.amount + fee, description: input.description },
    ];
    const r = await postOrQueueOut(admin, created, lines, `Expense ${payment_no} - ${input.description}`, input.amount + fee);
    if (!r.ok) return r;

    revalidatePath("/payments");
    return { ok: true, payment_no };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * NEW PAYMENT - "Owner Drawing / Other"
 *
 * Owner withdraws money for personal use, or tax remittance, or any non-COGS
 * non-expense cash-out. Posts:
 *   Dr Owner Drawings / specified account    [amount]
 *      Cr Cash / Bank                         [amount]
 */
export async function recordOwnerDrawing(input: {
  amount: number;
  payment_method_id: string;
  fee?: number;
  reference?: string | null;
  date?: string;
  debit_account_code?: string;  // 3100 owner drawings by default
  description?: string;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };
    const fee = Math.max(0, Number(input.fee || 0) || 0);

    const supabase = await createClient();
    const admin = createServiceClient();
    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const debitCode = input.debit_account_code || "3100";
    const desc = input.description || "Owner drawing";
    const { data: created, error } = await supabase.from("payments").insert({
      payment_no,
      date: input.date || new Date().toISOString().slice(0, 10),
      direction: "out",
      source_type: "other",
      payment_method_id: input.payment_method_id,
      amount: input.amount,
      fee,
      reference: input.reference ?? null,
      notes: `${desc}`,
    }).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    const lines: LineInput[] = [
      { account_code: debitCode, debit:  input.amount, description: desc },
      ...(fee > 0 ? [{ account_code: "5200", debit: fee, description: `Charges on ${payment_no}` }] : []),
      { account_code: asset,     credit: input.amount + fee, description: desc },
    ];
    const r = await postOrQueueOut(admin, created, lines, `Payment ${payment_no} - ${desc}`, input.amount + fee);
    if (!r.ok) return r;

    revalidatePath("/payments");
    return { ok: true, payment_no };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * BANK TRANSFER - move money between cash / bank assets.
 * Posts:
 *   Dr <destination asset>  [amount]
 *      Cr <source asset>    [amount]
 *
 * Records TWO payment rows (one OUT from source method, one IN to destination)
 * so both sides appear in the payments ledger; both rows reference the same
 * underlying transfer description in their notes for auditability.
 */
export async function recordBankTransfer(input: {
  from_payment_method_id: string;
  to_payment_method_id: string;
  amount: number;
  reference?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.from_payment_method_id || !input.to_payment_method_id) {
      return { ok: false, error: "Both source and destination required" };
    }
    if (input.from_payment_method_id === input.to_payment_method_id) {
      return { ok: false, error: "Source and destination must differ" };
    }

    // Can't transfer out more than the source account holds.
    const funds = await assertSufficientFunds(input.from_payment_method_id, input.amount, "the source account");
    if (!funds.ok) return { ok: false, error: funds.error };

    const admin = createServiceClient();
    const fromCode = await assetCodeForMethod(input.from_payment_method_id);
    const toCode   = await assetCodeForMethod(input.to_payment_method_id);
    if (fromCode === toCode) {
      return { ok: false, error: "Both methods map to the same account; nothing to transfer" };
    }

    const supabase = await createClient();
    const date = input.date || new Date().toISOString().slice(0, 10);
    const noteBase = input.notes || `Bank transfer`;
    const transferTag = `xfer-${Date.now().toString(36)}`;

    // 1) OUT leg
    const outPaymentNo = await reserveNextNumber("nextPayment", "PMT-");
    const { data: outPay } = await supabase.from("payments").insert({
      payment_no: outPaymentNo,
      date,
      direction: "out",
      source_type: "other",
      payment_method_id: input.from_payment_method_id,
      amount: input.amount,
      reference: input.reference ?? null,
      notes: `${noteBase} · ${transferTag} · OUT`,
    }).select("*").single();
    if (!outPay) return { ok: false, error: "Failed to create OUT leg" };

    // 2) IN leg
    const inPaymentNo = await reserveNextNumber("nextPayment", "PMT-");
    const { data: inPay } = await supabase.from("payments").insert({
      payment_no: inPaymentNo,
      date,
      direction: "in",
      source_type: "other",
      payment_method_id: input.to_payment_method_id,
      amount: input.amount,
      reference: input.reference ?? null,
      notes: `${noteBase} · ${transferTag} · IN`,
    }).select("*").single();
    if (!inPay) return { ok: false, error: "Failed to create IN leg" };

    // 3) Single combined journal entry (Dr destination / Cr source).
    await postJournal({
      date,
      description: `Transfer ${outPaymentNo} -> ${inPaymentNo}`,
      source_type: "payment",
      source_id: outPay.id,
      lines: [
        { account_code: toCode,   debit:  input.amount, description: noteBase },
        { account_code: fromCode, credit: input.amount, description: noteBase },
      ],
    });

    revalidatePath("/payments");
    return { ok: true, payment_no: outPaymentNo };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deletePayment(id: string): Promise<Result> {
  try {
    await requirePermission("payments", "delete");
    const admin = createServiceClient();
    const { data: pay } = await admin.from("payments").select("*").eq("id", id).single();
    if (!pay) return { ok: false, error: "Payment not found" };

    // Reverse the journal first
    await reverseJournalsForSource("payment", id);
    const { error } = await admin.from("payments").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    if (pay.sale_id) await recomputeSaleStatus(pay.sale_id);
    if (pay.purchase_id) await recomputePurchaseStatus(pay.purchase_id);

    revalidatePath("/payments");
    revalidatePath("/sales");
    revalidatePath("/purchases");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
