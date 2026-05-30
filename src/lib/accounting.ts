// Server-only helpers for posting double-entry journal entries.
// Imported from server actions ONLY (it uses the service-role client to
// post ledger lines so a Sales user without accounting permissions can
// still trigger an entry).

import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { reserveNextNumber } from "@/lib/numbering";
import type { Sale, Purchase, Payment } from "@/lib/types";

type LineInput = { account_code: string; debit?: number; credit?: number; description?: string };

type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/**
 * The standard chart of accounts the app posts against. Kept in sync with the
 * migrations (00005 + 00012 + 00013 + 00015). ensureChartOfAccounts() creates
 * any of these that are missing, so a freshly-provisioned tenant (or any DB
 * that never got the seed) self-heals instead of erroring on the first journal.
 */
export const STANDARD_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: "1000", name: "Cash on Hand",          type: "asset" },
  { code: "1010", name: "Cash Drawer",           type: "asset" },
  { code: "1100", name: "Bank",                  type: "asset" },
  { code: "1110", name: "M-Pesa Wallet",         type: "asset" },
  { code: "1200", name: "Accounts Receivable",   type: "asset" },
  { code: "1300", name: "Inventory",             type: "asset" },
  { code: "2000", name: "Accounts Payable",      type: "liability" },
  { code: "2100", name: "Tax Payable",           type: "liability" },
  { code: "2200", name: "Customer Advances",     type: "liability" },
  { code: "3000", name: "Owner Equity",          type: "equity" },
  { code: "3100", name: "Retained Earnings",     type: "equity" },
  { code: "4000", name: "Sales Revenue",         type: "income" },
  { code: "4100", name: "Other Income",          type: "income" },
  { code: "4200", name: "Interest Income",       type: "income" },
  { code: "5000", name: "Cost of Goods Sold",    type: "expense" },
  { code: "5100", name: "Salaries & Wages",      type: "expense" },
  { code: "5150", name: "Commission Expense",    type: "expense" },
  { code: "5160", name: "Bonus Expense",         type: "expense" },
  { code: "5200", name: "Bank Charges",          type: "expense" },
  { code: "5300", name: "Utilities",             type: "expense" },
  { code: "5400", name: "Office Supplies",       type: "expense" },
  { code: "5500", name: "Other Operating Expense", type: "expense" },
  { code: "5600", name: "Tax Remitted",          type: "expense" },
  { code: "5700", name: "Inventory Adjustment",  type: "expense" },
];

// Per-process guard: once the COA is confirmed present for this deployment's
// schema we skip the work. (Each deployment serves a single schema.)
let coaEnsured = false;

/**
 * Make sure the standard chart of accounts exists, creating any missing codes.
 * Idempotent and cheap on the hot path (one lookup once per process). Pass an
 * existing admin client to avoid creating another.
 */
export async function ensureChartOfAccounts(
  admin: ReturnType<typeof createServiceClient> = createServiceClient()
): Promise<void> {
  if (coaEnsured) return;
  const tid = currentTenantId();
  let existingQ = admin.from("accounts").select("code");
  if (tid) existingQ = existingQ.eq("tenant_id", tid);
  const { data: existing } = await existingQ;
  const have = new Set((existing || []).map((a) => a.code as string));
  const missing = STANDARD_ACCOUNTS.filter((a) => !have.has(a.code));
  if (missing.length) {
    await admin
      .from("accounts")
      .upsert(
        missing.map((a) => ({
          code: a.code, name: a.name, type: a.type, is_system: true, is_active: true,
          ...(tid ? { tenant_id: tid } : {}),
        })),
        // code is unique per tenant now, so conflict target includes tenant_id.
        { onConflict: tid ? "tenant_id,code" : "code", ignoreDuplicates: true }
      );
  }
  coaEnsured = true;
}

/**
 * Resolve a chart-of-accounts UUID by code. Auto-creates the standard chart of
 * accounts first if the code is missing, then retries — so callers never fail
 * just because the COA wasn't seeded.
 */
async function accountIdByCode(admin: ReturnType<typeof createServiceClient>, code: string) {
  const tid = currentTenantId();
  const lookup = async () => {
    let q = admin.from("accounts").select("id").eq("code", code);
    if (tid) q = q.eq("tenant_id", tid);
    return (await q.maybeSingle()).data;
  };
  const data = await lookup();
  if (data) return data.id as string;
  await ensureChartOfAccounts(admin);
  const retry = await lookup();
  if (!retry) throw new Error(`Account ${code} not found and is not a standard account.`);
  return retry.id as string;
}

/**
 * Post a journal entry. Lines must balance (sum debit == sum credit) or this
 * throws. Source links the entry back to the originating sale/purchase/payment.
 */
export async function postJournal(opts: {
  date: string;
  description: string;
  source_type: "manual" | "sale" | "purchase" | "payment";
  source_id?: string | null;
  lines: LineInput[];
}): Promise<{ ok: boolean; error?: string; entry_id?: string }> {
  try {
    const admin = createServiceClient();
    const totalDebit = opts.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const totalCredit = opts.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return { ok: false, error: `Journal does not balance (Dr ${totalDebit} vs Cr ${totalCredit})` };
    }
    const entry_no = await reserveNextNumber("nextJournal", "JE-");
    const { data: entry, error: entryErr } = await admin
      .from("journal_entries")
      .insert({
        entry_no,
        date: opts.date,
        description: opts.description,
        source_type: opts.source_type,
        source_id: opts.source_id ?? null,
      })
      .select("id")
      .single();
    if (entryErr || !entry) return { ok: false, error: entryErr?.message || "Failed to create entry" };

    const linesPayload = await Promise.all(
      opts.lines.map(async (l) => ({
        entry_id: entry.id,
        account_id: await accountIdByCode(admin, l.account_code),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        description: l.description ?? null,
      }))
    );
    const { error: linesErr } = await admin.from("journal_lines").insert(linesPayload);
    if (linesErr) return { ok: false, error: linesErr.message };
    return { ok: true, entry_id: entry.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Post the journal for a confirmed sale:
 *   Dr Accounts Receivable     [total]
 *      Cr Sales Revenue        [total - tax]  (works for both inclusive and exclusive pricing)
 *      Cr Tax Payable          [tax]
 *
 * Using `total - tax` for revenue (instead of `subtotal - discount`) keeps the
 * journal balanced regardless of whether tax was added on top (exclusive) or
 * extracted from the price (inclusive). In exclusive mode this equals
 * `subtotal - discount`; in inclusive mode `subtotal - discount` already
 * includes the tax, so we'd over-credit revenue by the tax amount.
 */
export async function postSaleJournal(sale: Sale) {
  const total = Number(sale.total);
  const tax = Number(sale.tax) || 0;
  const revenue = Math.round((total - tax) * 100) / 100;
  const lines: LineInput[] = [
    { account_code: "1200", debit: total,   description: `Sale ${sale.invoice_no}` },
    { account_code: "4000", credit: revenue, description: `Sale ${sale.invoice_no}` },
  ];
  if (tax > 0) {
    lines.push({ account_code: "2100", credit: tax, description: `Tax on ${sale.invoice_no}` });
  }
  return postJournal({
    date: sale.date,
    description: `Sale invoice ${sale.invoice_no}`,
    source_type: "sale",
    source_id: sale.id,
    lines,
  });
}

/**
 * Cost-of-goods-sold journal — posted on sale confirmation so the income
 * statement shows the right gross profit.
 *
 *   Dr Cost of Goods Sold (5000)  [sum(cost_price * qty)]
 *      Cr Inventory (1300)        [same]
 *
 * Cost is looked up from `products.cost_price` at the time of confirmation
 * (we don't store cost on the sale line). For serial-tracked products, the
 * caller should pass per-line cost overrides via `lineCosts`.
 */
export async function postCogsJournal(
  sale: Sale,
  lineCosts?: Record<string, number>,
): Promise<{ ok: boolean; error?: string; entry_id?: string; total_cogs?: number }> {
  const admin = createServiceClient();

  // Build a refId -> cost map. Prefer caller-provided overrides (e.g. per-unit
  // FIFO costs from inventory_units); fall back to current products.cost_price.
  const refIds = Array.from(new Set(sale.items.map((l) => l.refId)));
  const costMap: Record<string, number> = {};
  if (refIds.length > 0) {
    const { data: prods } = await admin
      .from("products")
      .select("id, cost_price")
      .in("id", refIds);
    for (const p of prods || []) costMap[p.id] = Number(p.cost_price) || 0;
  }
  let totalCogs = 0;
  for (const l of sale.items) {
    const unit = lineCosts?.[l.refId] ?? costMap[l.refId] ?? 0;
    totalCogs += unit * Number(l.qty);
  }
  totalCogs = Math.round(totalCogs * 100) / 100;
  if (totalCogs <= 0) return { ok: true, total_cogs: 0 };

  const r = await postJournal({
    date: sale.date,
    description: `COGS for ${sale.invoice_no}`,
    source_type: "sale",
    source_id: sale.id,
    lines: [
      { account_code: "5000", debit: totalCogs, description: `COGS ${sale.invoice_no}` },
      { account_code: "1300", credit: totalCogs, description: `Stock relieved for ${sale.invoice_no}` },
    ],
  });
  return { ...r, total_cogs: totalCogs };
}

/**
 * Post the journal for a received purchase:
 *   Dr Inventory                [total - tax]   (works for both inclusive and exclusive)
 *   Dr Tax Payable (input tax)  [tax]
 *      Cr Accounts Payable      [total]
 *
 * Inventory is debited net-of-tax (`total - tax`) so cost_price stays clean
 * regardless of whether the supplier invoice quoted prices including tax
 * (inclusive) or with tax added on top (exclusive).
 */
export async function postPurchaseJournal(purchase: Purchase) {
  const total = Number(purchase.total);
  const tax = Number(purchase.tax) || 0;
  const inventory = Math.round((total - tax) * 100) / 100;
  const lines: LineInput[] = [
    { account_code: "1300", debit: inventory, description: `Purchase ${purchase.po_no}` },
    { account_code: "2000", credit: total,    description: `Purchase ${purchase.po_no}` },
  ];
  if (tax > 0) {
    lines.push({ account_code: "2100", debit: tax, description: `Input tax on ${purchase.po_no}` });
  }
  return postJournal({
    date: purchase.date,
    description: `Purchase order ${purchase.po_no}`,
    source_type: "purchase",
    source_id: purchase.id,
    lines,
  });
}

/**
 * Resolve the asset account that a given payment-method's funds land in.
 * Cash drawer -> 1010 ; M-Pesa -> 1110 ; Bank -> bank_account.account_id (or 1100) ; Card -> 1100.
 */
async function resolvePaymentMethodAccountCode(
  admin: ReturnType<typeof createServiceClient>,
  payment_method_id: string | null
): Promise<string> {
  if (!payment_method_id) return "1010";
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
        .select("account_id")
        .eq("id", pm.bank_account_id)
        .single();
      if (ba?.account_id) {
        const { data: acc } = await admin
          .from("accounts")
          .select("code")
          .eq("id", ba.account_id)
          .single();
        if (acc?.code) return acc.code as string;
      }
    }
    return "1100";
  }
  return "1010";
}

/**
 * Post the payment journal:
 *   Inflow (sale receipt):  Dr <asset>  Cr Accounts Receivable
 *   Outflow (supplier pay): Dr Accounts Payable  Cr <asset>
 */
export async function postPaymentJournal(payment: Payment) {
  const admin = createServiceClient();
  const assetCode = await resolvePaymentMethodAccountCode(admin, payment.payment_method_id);
  const isInflow = payment.direction === "in";
  const lines: LineInput[] = isInflow
    ? [
        { account_code: assetCode, debit: Number(payment.amount), description: `Payment ${payment.payment_no}` },
        { account_code: "1200",    credit: Number(payment.amount), description: `Receipt for ${payment.payment_no}` },
      ]
    : [
        { account_code: "2000",    debit: Number(payment.amount), description: `Payment ${payment.payment_no}` },
        { account_code: assetCode, credit: Number(payment.amount), description: `Outflow for ${payment.payment_no}` },
      ];
  return postJournal({
    date: payment.date,
    description: isInflow
      ? `Receipt ${payment.payment_no}`
      : `Payment to supplier ${payment.payment_no}`,
    source_type: "payment",
    source_id: payment.id,
    lines,
  });
}

/**
 * Reverse a previously-posted journal by inserting a mirror entry. Used when a
 * sale or purchase is cancelled.
 */
export async function reverseJournalsForSource(source_type: "sale" | "purchase" | "payment", source_id: string) {
  const admin = createServiceClient();
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id, date, description")
    .eq("source_type", source_type)
    .eq("source_id", source_id);
  if (!entries?.length) return { ok: true };
  for (const e of entries) {
    const { data: lines } = await admin.from("journal_lines").select("account_id, debit, credit, description").eq("entry_id", e.id);
    if (!lines?.length) continue;
    const entry_no = await reserveNextNumber("nextJournal", "JE-");
    const { data: rev, error } = await admin
      .from("journal_entries")
      .insert({
        entry_no,
        date: new Date().toISOString().slice(0, 10),
        description: `Reversal of ${e.description ?? e.id}`,
        source_type,
        source_id,
      })
      .select("id")
      .single();
    if (error || !rev) continue;
    await admin.from("journal_lines").insert(
      lines.map((l) => ({
        entry_id: rev.id,
        account_id: l.account_id,
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
        description: `Rev: ${l.description ?? ""}`.trim(),
      }))
    );
  }
  return { ok: true };
}

/**
 * Sum up payments for a sale and flip status to 'paid' if covered. Also keeps
 * the cached amount_paid column in sync so list views can show balance without
 * an aggregation query.
 */
export async function recomputeSaleStatus(sale_id: string) {
  const admin = createServiceClient();
  const { data: sale } = await admin.from("sales").select("total, status, customer_id").eq("id", sale_id).single();
  if (!sale) return;
  if (sale.status !== "cancelled" && sale.status !== "draft") {
    const { data: pays } = await admin
      .from("payments")
      .select("amount")
      .eq("sale_id", sale_id)
      .eq("direction", "in");
    const paid = (pays || []).reduce((s, p) => s + Number(p.amount), 0);
    const next = paid >= Number(sale.total) - 0.01 ? "paid" : "confirmed";
    await admin.from("sales").update({ status: next, amount_paid: paid }).eq("id", sale_id);
  }
  // Keep the customer's outstanding balance (AR) in sync — including the
  // remainder on a partial cash sale.
  await recomputeCustomerBalance(sale.customer_id as string | null);
}

export async function recomputePurchaseStatus(purchase_id: string) {
  const admin = createServiceClient();
  const { data: po } = await admin.from("purchases").select("total, status, supplier_id").eq("id", purchase_id).single();
  if (!po) return;
  if (po.status !== "cancelled" && po.status !== "draft" && po.status !== "ordered") {
    const { data: pays } = await admin
      .from("payments")
      .select("amount")
      .eq("purchase_id", purchase_id)
      .eq("direction", "out");
    const paid = (pays || []).reduce((s, p) => s + Number(p.amount), 0);
    const next = paid >= Number(po.total) - 0.01 ? "paid" : "received";
    await admin.from("purchases").update({ status: next, amount_paid: paid }).eq("id", purchase_id);
  }
  await recomputeSupplierBalance(po.supplier_id as string | null);
}

/** Recompute a customer's outstanding balance = Σ(total − amount_paid) over
 *  their non-cancelled sales. Keeps the cached customers.balance accurate so
 *  partial payments show the remaining balance. */
export async function recomputeCustomerBalance(customer_id: string | null) {
  if (!customer_id) return;
  const admin = createServiceClient();
  const { data: rows } = await admin
    .from("sales")
    .select("total, amount_paid, status")
    .eq("customer_id", customer_id)
    .neq("status", "cancelled");
  const bal = (rows || []).reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid || 0)), 0);
  await admin.from("customers").update({ balance: Math.round(bal * 100) / 100 }).eq("id", customer_id);
}

/** Recompute a supplier's outstanding balance = Σ(total − amount_paid) over
 *  their non-cancelled purchases (what we still owe them). */
export async function recomputeSupplierBalance(supplier_id: string | null) {
  if (!supplier_id) return;
  const admin = createServiceClient();
  const { data: rows } = await admin
    .from("purchases")
    .select("total, amount_paid, status")
    .eq("supplier_id", supplier_id)
    .neq("status", "cancelled");
  const bal = (rows || []).reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid || 0)), 0);
  await admin.from("suppliers").update({ balance: Math.round(bal * 100) / 100 }).eq("id", supplier_id);
}

/** Compute a balance for an account by summing journal_lines. */
export async function getAccountBalance(account_id: string): Promise<number> {
  const admin = createServiceClient();
  const { data } = await admin.from("journal_lines").select("debit, credit").eq("account_id", account_id);
  return (data || []).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
}

/**
 * Money currently available behind a payment method = the asset account's
 * journal balance, PLUS any bank opening balance (which isn't journaled).
 * Used to refuse paying out more than you actually have.
 */
export async function availableFunds(payment_method_id: string | null): Promise<number> {
  const admin = createServiceClient();
  const tid = currentTenantId();

  const balanceByCode = async (code: string): Promise<number> => {
    let q = admin.from("accounts").select("id").eq("code", code);
    if (tid) q = q.eq("tenant_id", tid);
    const { data: acc } = await q.maybeSingle();
    return acc ? getAccountBalance(acc.id as string) : 0;
  };

  if (!payment_method_id) return balanceByCode("1010"); // default cash drawer

  const { data: pm } = await admin
    .from("payment_methods").select("kind, bank_account_id").eq("id", payment_method_id).single();
  if (!pm) return balanceByCode("1010");

  if (pm.kind === "bank" && pm.bank_account_id) {
    const { data: ba } = await admin
      .from("bank_accounts").select("opening_balance, account_id").eq("id", pm.bank_account_id).single();
    let bal = Number(ba?.opening_balance || 0);
    if (ba?.account_id) bal += await getAccountBalance(ba.account_id as string);
    return bal;
  }

  const code = pm.kind === "cash" ? "1010" : pm.kind === "mpesa" ? "1110" : pm.kind === "card" ? "1100" : "1010";
  return balanceByCode(code);
}

/** Throwable guard: refuse to move more money than is available. */
export async function assertSufficientFunds(payment_method_id: string | null, amount: number, label = "this account"): Promise<{ ok: boolean; error?: string; available?: number }> {
  const available = await availableFunds(payment_method_id);
  if (amount > available + 0.01) {
    return {
      ok: false,
      available,
      error: `Insufficient funds in ${label}: available ${available.toFixed(2)}, but the payment is ${amount.toFixed(2)}. Record income/transfer first, or reduce the amount.`,
    };
  }
  return { ok: true, available };
}
