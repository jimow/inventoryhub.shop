import "server-only";
import { createServiceClient, currentTenantId } from "@/lib/supabase/server";

/**
 * THE single source of truth for every money figure in the app.
 *
 * Each account's balance is the net of its journal lines (debit − credit),
 * with bank-account opening balances folded into their linked asset account so
 * that the cash/bank figures here match exactly what the payment screens use
 * (availableFunds also adds opening balances). Anything that displays a balance
 * — Dashboard, Equity page, Balance Sheet — should read from this snapshot so
 * the same data item never shows two different numbers.
 *
 * Sign convention: asset & expense are debit-positive; liability, equity and
 * income are credit-positive. So every value below reads "naturally" (a bigger
 * positive number = more cash / more equity / more revenue).
 */
export type LedgerSnapshot = {
  /** Signed balance per account code (opening balances folded into linked asset). */
  byCode: Record<string, number>;
  // Type roll-ups (signed)
  asset: number;
  liability: number;
  equity: number;        // equity *accounts* only (3000, 3100, …)
  income: number;
  expense: number;
  netProfit: number;     // income − expense (current retained earnings)
  openingBankEquity: number; // Σ bank opening balances (the equity counterpart)
  // Liquidity
  cash: number;          // 1000 + 1010
  bank: number;          // 1100 + 1110 + any custom bank-linked accounts
  cashAndBank: number;
  // Common balances
  inventory: number;     // 1300
  receivables: number;   // 1200
  payables: number;      // 2000
  ownerEquity: number;   // 3000 (contributed capital)
  // Balance-sheet totals (A = L + E always holds)
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;   // equity accounts + netProfit + openingBankEquity
};

const CREDIT_TYPES = new Set(["liability", "equity", "income"]);
const CASH_CODES = ["1000", "1010"];
const BANK_CODES = ["1100", "1110"];

/** All-zero snapshot — used as a safe fallback so a reporting read can never
 *  take down the Dashboard / Equity page with a 500. */
function emptySnapshot(): LedgerSnapshot {
  return {
    byCode: {},
    asset: 0, liability: 0, equity: 0, income: 0, expense: 0, netProfit: 0, openingBankEquity: 0,
    cash: 0, bank: 0, cashAndBank: 0,
    inventory: 0, receivables: 0, payables: 0, ownerEquity: 0,
    totalAssets: 0, totalLiabilities: 0, totalEquity: 0,
  };
}

export async function getLedgerSnapshot(): Promise<LedgerSnapshot> {
  try {
    return await computeLedgerSnapshot();
  } catch (e) {
    // Never crash a page over a balances read — log and fall back to zeros.
    console.error("[getLedgerSnapshot] failed:", e);
    return emptySnapshot();
  }
}

async function computeLedgerSnapshot(): Promise<LedgerSnapshot> {
  const admin = createServiceClient();
  const tid = currentTenantId();

  let accountsQ = admin.from("accounts").select("id, code, type");
  let linesQ = admin.from("journal_lines").select("account_id, debit, credit");
  let banksQ = admin.from("bank_accounts").select("opening_balance, account_id");
  if (tid) {
    accountsQ = accountsQ.eq("tenant_id", tid);
    linesQ = linesQ.eq("tenant_id", tid);
    banksQ = banksQ.eq("tenant_id", tid);
  }
  const [{ data: accounts }, { data: lines }, { data: banks }] = await Promise.all([
    accountsQ, linesQ, banksQ,
  ]);

  const accById = new Map((accounts || []).map((a) => [a.id as string, a]));

  // Net (debit − credit) per account id from the journal.
  const netById = new Map<string, number>();
  for (const l of lines || []) {
    netById.set(
      l.account_id as string,
      (netById.get(l.account_id as string) || 0) + Number(l.debit) - Number(l.credit),
    );
  }

  // Fold bank opening balances into their linked asset account (debit-positive),
  // exactly as availableFunds() does — keeps cash consistent app-wide.
  let openingBankEquity = 0;
  for (const b of banks || []) {
    const amt = Number(b.opening_balance || 0);
    if (!amt || !b.account_id) continue;
    netById.set(b.account_id as string, (netById.get(b.account_id as string) || 0) + amt);
    openingBankEquity += amt;
  }

  const byCode: Record<string, number> = {};
  let asset = 0, liability = 0, equity = 0, income = 0, expense = 0;
  for (const a of accounts || []) {
    const net = netById.get(a.id as string) || 0;
    const signed = CREDIT_TYPES.has(a.type as string) ? -net : net;
    byCode[a.code as string] = (byCode[a.code as string] || 0) + signed;
    switch (a.type) {
      case "asset": asset += signed; break;
      case "liability": liability += signed; break;
      case "equity": equity += signed; break;
      case "income": income += signed; break;
      case "expense": expense += signed; break;
    }
  }

  const netProfit = income - expense;

  const cash = CASH_CODES.reduce((s, c) => s + (byCode[c] || 0), 0);

  // Bank = standard bank codes + any custom account linked to a bank_account
  // that isn't already one of the standard codes (avoid double counting).
  const counted = new Set<string>([...CASH_CODES, ...BANK_CODES]);
  let bank = BANK_CODES.reduce((s, c) => s + (byCode[c] || 0), 0);
  for (const b of banks || []) {
    if (!b.account_id) continue;
    const a = accById.get(b.account_id as string);
    if (a && !counted.has(a.code as string)) {
      bank += byCode[a.code as string] || 0;
      counted.add(a.code as string);
    }
  }

  return {
    byCode,
    asset, liability, equity, income, expense, netProfit, openingBankEquity,
    cash, bank, cashAndBank: cash + bank,
    inventory: byCode["1300"] || 0,
    receivables: byCode["1200"] || 0,
    payables: byCode["2000"] || 0,
    ownerEquity: byCode["3000"] || 0,
    totalAssets: asset,
    totalLiabilities: liability,
    totalEquity: equity + netProfit + openingBankEquity,
  };
}
