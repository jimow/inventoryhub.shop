"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requirePermission, getCurrentSession } from "@/lib/auth";
import { reserveNextNumber, getSettings } from "@/lib/numbering";
import {
  postJournal, resolvePaymentMethodAccountCode, ensureChartOfAccounts, assertSufficientFunds,
} from "@/lib/accounting";
import { ownershipPercents } from "@/lib/equity";
import type { Shareholder, EquityContribution } from "@/lib/types";

type Result = { ok: boolean; error?: string };

const RETAINED_EARNINGS = "3100";
const DIVIDENDS_PAYABLE = "2400";

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
/* DECLARE a dividend — split by ownership %, post Dr RE / Cr Dividends Payable */
/* -------------------------------------------------------------------------- */
export async function declareDividend(formData: FormData): Promise<Result> {
  try {
    await requirePermission("equity", "create");
    const total = Math.round((Number(formData.get("total_amount") || 0) || 0) * 100) / 100;
    if (total <= 0) return { ok: false, error: "Total dividend must be greater than 0" };
    const rate = Math.max(0, Number(formData.get("rate") || 0) || 0);
    const base_amount = Math.round((Number(formData.get("base_amount") || 0) || 0) * 100) / 100;
    const date = String(formData.get("date") || new Date().toISOString().slice(0, 10));
    const period_label = String(formData.get("period_label") || "").trim() || null;
    const notes = String(formData.get("notes") || "").trim() || null;

    const admin = createServiceClient();
    await ensureChartOfAccounts(admin);
    const tid = currentTenantId();

    let shQ = admin.from("shareholders").select("*").eq("status", "active");
    let coQ = admin.from("equity_contributions").select("*");
    if (tid) { shQ = shQ.eq("tenant_id", tid); coQ = coQ.eq("tenant_id", tid); }
    const [{ data: shareholders }, { data: contributions }, cfg] = await Promise.all([shQ, coQ, getSettings()]);
    const allSh = (shareholders as Shareholder[]) || [];

    // Ownership %: derived from capital contributed, or fixed — same logic the
    // Equity page shows, so dividends match what owners see.
    const mode = cfg.equity?.ownershipMode === "fixed" ? "fixed" : "contribution";
    const pct = ownershipPercents(allSh, (contributions as EquityContribution[]) || [], mode);
    const active = allSh.filter((s) => (pct.get(s.id) || 0) > 0);
    if (!active.length) {
      return { ok: false, error: mode === "contribution"
        ? "No active shareholders with capital contributed to distribute to."
        : "No active shareholders with an ownership % to distribute to." };
    }
    const sumPct = active.reduce((s, sh) => s + (pct.get(sh.id) || 0), 0);

    const declaration_no = await reserveNextNumber("nextDividend", "DIV-");
    const { userId } = await getCurrentSession();

    const { data: decl, error: insErr } = await admin.from("dividend_declarations").insert({
      declaration_no, date, period_label, rate, base_amount, total_amount: total,
      status: "active", notes, created_by: userId,
    }).select("id").single();
    if (insErr || !decl) return { ok: false, error: insErr?.message || "Failed to declare" };

    // Split total by each shareholder's share of total ownership (so the whole
    // total is distributed even if ownership doesn't sum to exactly 100%).
    const lines = active.map((s) => ({
      declaration_id: decl.id,
      shareholder_id: s.id,
      ownership_pct: Math.round((pct.get(s.id) || 0) * 100) / 100,
      amount: Math.round((total * (pct.get(s.id) || 0) / sumPct) * 100) / 100,
    }));
    await admin.from("dividend_lines").insert(lines);

    const j = await postJournal({
      date, description: `Dividend ${declaration_no}${period_label ? ` — ${period_label}` : ""}`,
      source_type: "manual", source_id: decl.id,
      lines: [
        { account_code: RETAINED_EARNINGS, debit: total, description: "Dividend declared" },
        { account_code: DIVIDENDS_PAYABLE, credit: total, description: "Dividend payable to shareholders" },
      ],
    });
    if (!j.ok) {
      await admin.from("dividend_declarations").delete().eq("id", decl.id);
      return { ok: false, error: `Journal failed: ${j.error}` };
    }
    await admin.from("dividend_declarations").update({ journal_entry_id: j.entry_id ?? null }).eq("id", decl.id);

    revalidatePath("/dividends"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/* -------------------------------------------------------------------------- */
/* PAY OUT a shareholder's dividend — Dr Dividends Payable / Cr Cash           */
/* -------------------------------------------------------------------------- */
export async function payoutDividend(formData: FormData): Promise<Result> {
  try {
    await requirePermission("equity", "create");
    const declaration_id = String(formData.get("declaration_id") || "");
    const shareholder_id = String(formData.get("shareholder_id") || "");
    if (!declaration_id || !shareholder_id) return { ok: false, error: "Missing dividend line" };
    const amount = Math.round((Number(formData.get("amount") || 0) || 0) * 100) / 100;
    if (amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
    const date = String(formData.get("date") || new Date().toISOString().slice(0, 10));
    const payment_method_id = (String(formData.get("payment_method_id") || "") || null) as string | null;

    const admin = createServiceClient();
    await ensureChartOfAccounts(admin);

    // Can't pay more than this shareholder's remaining dividend.
    const { data: line } = await admin.from("dividend_lines").select("amount, shareholder_id")
      .eq("declaration_id", declaration_id).eq("shareholder_id", shareholder_id).maybeSingle();
    if (!line) return { ok: false, error: "Dividend line not found" };
    const { data: prior } = await admin.from("dividend_payouts").select("amount")
      .eq("declaration_id", declaration_id).eq("shareholder_id", shareholder_id).neq("status", "cancelled");
    const paid = (prior || []).reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Math.round((Number(line.amount) - paid) * 100) / 100;
    if (amount > outstanding + 0.01) return { ok: false, error: `Only ${outstanding.toFixed(2)} remains for this shareholder.` };

    // Paying out cash — don't pay what you don't have.
    const funds = await assertSufficientFunds(payment_method_id, amount, "the pay account");
    if (!funds.ok) return { ok: false, error: funds.error };

    const { data: sh } = await admin.from("shareholders").select("name").eq("id", shareholder_id).single();
    const assetCode = await resolvePaymentMethodAccountCode(admin, payment_method_id);
    const payout_no = await reserveNextNumber("nextPayment", "PMT-");
    const { userId } = await getCurrentSession();

    const { data: po, error: insErr } = await admin.from("dividend_payouts").insert({
      payout_no, declaration_id, shareholder_id, date, amount, payment_method_id,
      status: "posted", created_by: userId,
    }).select("id").single();
    if (insErr || !po) return { ok: false, error: insErr?.message || "Failed to pay" };

    const j = await postJournal({
      date, description: `Dividend payout ${payout_no} — ${sh?.name ?? "shareholder"}`,
      source_type: "manual", source_id: po.id,
      lines: [
        { account_code: DIVIDENDS_PAYABLE, debit: amount, description: `Dividend to ${sh?.name ?? ""}` },
        { account_code: assetCode, credit: amount, description: `Dividend paid to ${sh?.name ?? ""}` },
      ],
    });
    if (!j.ok) {
      await admin.from("dividend_payouts").delete().eq("id", po.id);
      return { ok: false, error: `Journal failed: ${j.error}` };
    }
    await admin.from("dividend_payouts").update({ journal_entry_id: j.entry_id ?? null }).eq("id", po.id);

    revalidatePath("/dividends"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function cancelDividend(id: string): Promise<Result> {
  try {
    await requirePermission("equity", "edit");
    const admin = createServiceClient();
    const { data: decl } = await admin.from("dividend_declarations").select("*").eq("id", id).single();
    if (!decl) return { ok: false, error: "Not found" };
    if (decl.status === "cancelled") return { ok: false, error: "Already cancelled" };
    const { data: payouts } = await admin.from("dividend_payouts").select("id, journal_entry_id, payout_no, status").eq("declaration_id", id);
    for (const p of payouts || []) {
      if (p.status === "cancelled") continue;
      await reverseEntry(admin, p.journal_entry_id, `dividend payout ${p.payout_no}`, p.id);
      await admin.from("dividend_payouts").update({ status: "cancelled" }).eq("id", p.id);
    }
    await reverseEntry(admin, decl.journal_entry_id, `dividend ${decl.declaration_no}`, id);
    await admin.from("dividend_declarations").update({ status: "cancelled" }).eq("id", id);
    revalidatePath("/dividends"); revalidatePath("/journal"); revalidatePath("/reports");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
