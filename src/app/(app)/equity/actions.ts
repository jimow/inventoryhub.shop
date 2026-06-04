"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber } from "@/lib/numbering";
import {
  postJournal, resolvePaymentMethodAccountCode, ensureChartOfAccounts,
  assertSufficientFunds, getAccountBalance,
} from "@/lib/accounting";

type Result = { ok: boolean; error?: string };

const OWNER_EQUITY = "3000";
const OPENING_BALANCE_EQUITY = "3200";

/* -------------------------------------------------------------------------- */
/* SHAREHOLDERS                                                                */
/* -------------------------------------------------------------------------- */
export async function saveShareholder(formData: FormData, id?: string): Promise<Result> {
  try {
    await requirePermission("equity", id ? "edit" : "create");
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Name is required" };
    const payload = {
      name,
      code: String(formData.get("code") || "").trim() || null,
      email: String(formData.get("email") || "").trim() || null,
      phone: String(formData.get("phone") || "").trim() || null,
      ownership_pct: Math.max(0, Math.min(100, Number(formData.get("ownership_pct") || 0) || 0)),
      notes: String(formData.get("notes") || "").trim() || null,
      status: (String(formData.get("status") || "active") as "active" | "inactive"),
    };
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("shareholders").update(payload).eq("id", id)
      : await supabase.from("shareholders").insert(payload);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/equity");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deleteShareholder(id: string): Promise<Result> {
  try {
    await requirePermission("equity", "delete");
    const admin = createServiceClient();
    const { count } = await admin.from("equity_contributions")
      .select("id", { count: "exact", head: true }).eq("shareholder_id", id).neq("status", "cancelled");
    if ((count || 0) > 0) return { ok: false, error: "Shareholder has contributions — cancel them first." };
    const supabase = await createClient();
    const { error } = await supabase.from("shareholders").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/equity");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/* -------------------------------------------------------------------------- */
/* CONTRIBUTIONS / WITHDRAWALS (with journal)                                  */
/* -------------------------------------------------------------------------- */
export async function recordContribution(formData: FormData): Promise<Result> {
  try {
    await requirePermission("equity", "create");
    const shareholder_id = String(formData.get("shareholder_id") || "");
    if (!shareholder_id) return { ok: false, error: "Shareholder is required" };
    const kind = (String(formData.get("kind") || "contribution") as "contribution" | "withdrawal");
    const amount = Math.round((Number(formData.get("amount") || 0) || 0) * 100) / 100;
    if (amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    const date = String(formData.get("date") || new Date().toISOString().slice(0, 10));
    const payment_method_id = (String(formData.get("payment_method_id") || "") || null) as string | null;
    const notes = String(formData.get("notes") || "").trim() || null;
    // "cash" = money in via a payment method; "opening" = claim a share of
    // equity already on the books (opening stock / opening balances).
    const source = kind === "contribution" && String(formData.get("source") || "cash") === "opening"
      ? "opening" : "cash";

    const admin = createServiceClient();
    await ensureChartOfAccounts(admin);

    // A cash withdrawal pays money OUT — don't pay what you don't have.
    if (kind === "withdrawal") {
      const funds = await assertSufficientFunds(payment_method_id, amount, "the pay account");
      if (!funds.ok) return { ok: false, error: funds.error };
    }

    const { data: sh } = await admin.from("shareholders").select("name").eq("id", shareholder_id).single();
    if (!sh) return { ok: false, error: "Shareholder not found" };

    // In-kind/opening reclassifies from Opening Balance Equity (3200); cash uses
    // the payment-method asset account.
    const assetCode = source === "opening" ? OPENING_BALANCE_EQUITY
      : await resolvePaymentMethodAccountCode(admin, payment_method_id);
    const contribution_no = await reserveNextNumber("nextEquity", "EQ-");
    const { userId } = await getCurrentSession();

    const { data: row, error: insErr } = await admin.from("equity_contributions").insert({
      contribution_no, shareholder_id, date, kind, amount, source,
      payment_method_id: source === "opening" ? null : payment_method_id,
      status: "posted", notes, created_by: userId,
    }).select("id").single();
    if (insErr || !row) return { ok: false, error: insErr?.message || "Failed to record" };

    // contribution: Dr asset (or 3200 for opening) / Cr Owner Equity ; withdrawal: reverse.
    const capitalDesc = source === "opening" ? `Opening capital — ${sh.name}` : `Capital from ${sh.name}`;
    const lines = kind === "contribution"
      ? [
          { account_code: assetCode, debit: amount, description: capitalDesc },
          { account_code: OWNER_EQUITY, credit: amount, description: capitalDesc },
        ]
      : [
          { account_code: OWNER_EQUITY, debit: amount, description: `Capital withdrawal — ${sh.name}` },
          { account_code: assetCode, credit: amount, description: `Capital withdrawal — ${sh.name}` },
        ];
    const j = await postJournal({
      date,
      description: `${kind === "contribution" ? (source === "opening" ? "Opening capital" : "Capital contribution") : "Capital withdrawal"} ${contribution_no} — ${sh.name}`,
      source_type: "manual",
      source_id: row.id,
      lines,
    });
    if (!j.ok) {
      await admin.from("equity_contributions").delete().eq("id", row.id);
      return { ok: false, error: `Journal failed: ${j.error}` };
    }
    await admin.from("equity_contributions").update({ journal_entry_id: j.entry_id ?? null }).eq("id", row.id);

    revalidatePath("/equity");
    revalidatePath("/journal");
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function cancelContribution(id: string): Promise<Result> {
  try {
    await requirePermission("equity", "edit");
    const admin = createServiceClient();
    const { data: c } = await admin.from("equity_contributions").select("*").eq("id", id).single();
    if (!c) return { ok: false, error: "Not found" };
    if (c.status === "cancelled") return { ok: false, error: "Already cancelled" };

    // Reverse the journal so the books rebalance.
    if (c.journal_entry_id) {
      const { data: lines } = await admin.from("journal_lines")
        .select("account_id, debit, credit, description").eq("entry_id", c.journal_entry_id);
      if (lines?.length) {
        const reversal_no = await reserveNextNumber("nextJournal", "JE-");
        const { data: rev } = await admin.from("journal_entries").insert({
          entry_no: reversal_no, date: new Date().toISOString().slice(0, 10),
          description: `Reversal of equity ${c.contribution_no}`, source_type: "manual", source_id: id,
        }).select("id").single();
        if (rev) {
          await admin.from("journal_lines").insert(lines.map((l) => ({
            entry_id: rev.id, account_id: l.account_id,
            debit: Number(l.credit) || 0, credit: Number(l.debit) || 0,
            description: `Reversal: ${l.description ?? ""}`.trim(),
          })));
        }
      }
    }
    await admin.from("equity_contributions").update({ status: "cancelled" }).eq("id", id);
    revalidatePath("/equity");
    revalidatePath("/journal");
    revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Current total equity (Owner Equity account balance, credit-positive). */
export async function ownerEquityBalance(): Promise<number> {
  const admin = createServiceClient();
  const tid = currentTenantId();
  let q = admin.from("accounts").select("id").eq("code", OWNER_EQUITY);
  if (tid) q = q.eq("tenant_id", tid);
  const { data: acc } = await q.maybeSingle();
  if (!acc) return 0;
  // Owner equity is a credit-balance account → negate the debit-positive sum.
  return -(await getAccountBalance(acc.id as string));
}
