"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import { reserveNextNumber } from "@/lib/numbering";
import { postPaymentJournal, postJournal, recomputeSaleStatus, recomputePurchaseStatus, reverseJournalsForSource, assertSufficientFunds } from "@/lib/accounting";
import type { PaymentDirection, PaymentSource } from "@/lib/types";

type Result = { ok: boolean; error?: string };

export async function recordPayment(input: {
  direction: PaymentDirection;
  source_type: PaymentSource;
  sale_id?: string | null;
  purchase_id?: string | null;
  customer_id?: string | null;
  supplier_id?: string | null;
  payment_method_id: string;
  amount: number;
  reference?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };

    // Money out can't exceed what's available in the source account.
    if (input.direction === "out") {
      const funds = await assertSufficientFunds(input.payment_method_id, input.amount);
      if (!funds.ok) return { ok: false, error: funds.error };
    }

    const supabase = await createClient();
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
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    };
    const { data: created, error } = await supabase.from("payments").insert(payload).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed to record payment" };

    // Auto-post journal & recompute source status
    await postPaymentJournal(created);
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
  reference?: string | null;
  date?: string;
  notes?: string | null;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.customer_id) return { ok: false, error: "Customer is required" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };

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
        { account_code: asset, debit: input.amount, description: `Deposit from ${cust?.name ?? "customer"}` },
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
  reference?: string | null;
  date?: string;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };
    if (!input.description.trim()) return { ok: false, error: "Describe what the income is for" };

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
        { account_code: asset,      debit:  input.amount, description: input.description },
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

    const funds = await assertSufficientFunds(input.payment_method_id, input.amount);
    if (!funds.ok) return { ok: false, error: funds.error };

    const supabase = await createClient();
    const payment_no = await reserveNextNumber("nextPayment", "PMT-");
    const { data: created, error } = await supabase.from("payments").insert({
      payment_no,
      date: input.date || new Date().toISOString().slice(0, 10),
      direction: "out",
      source_type: "other",
      supplier_id: input.supplier_id ?? null,
      payment_method_id: input.payment_method_id,
      amount: input.amount,
      reference: input.reference ?? null,
      notes: `Expense · ${input.description}`,
    }).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    await postJournal({
      date: created.date,
      description: `Expense ${payment_no} - ${input.description}`,
      source_type: "payment",
      source_id: created.id,
      lines: [
        { account_code: input.expense_account_code, debit:  input.amount, description: input.description },
        { account_code: asset,                       credit: input.amount, description: input.description },
      ],
    });

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
  reference?: string | null;
  date?: string;
  debit_account_code?: string;  // 3100 owner drawings by default
  description?: string;
}): Promise<Result & { payment_no?: string }> {
  try {
    await requirePermission("payments", "create");
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    if (!input.payment_method_id) return { ok: false, error: "Payment method is required" };

    const funds = await assertSufficientFunds(input.payment_method_id, input.amount);
    if (!funds.ok) return { ok: false, error: funds.error };

    const supabase = await createClient();
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
      reference: input.reference ?? null,
      notes: `${desc}`,
    }).select("*").single();
    if (error || !created) return { ok: false, error: error?.message || "Failed" };

    const asset = await assetCodeForMethod(input.payment_method_id);
    await postJournal({
      date: created.date,
      description: `Payment ${payment_no} - ${desc}`,
      source_type: "payment",
      source_id: created.id,
      lines: [
        { account_code: debitCode, debit:  input.amount, description: desc },
        { account_code: asset,     credit: input.amount, description: desc },
      ],
    });

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
