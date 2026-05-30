"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Scale, TrendingUp, Building2, BookOpen, BarChart3,
  Printer, Wrench, Loader2, AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn, formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import type { Account, JournalLine, JournalEntry, SettingsData } from "@/lib/types";
import { reconcileOpeningStockEquity } from "../products/actions";

type Tab = "trial" | "pnl" | "balance" | "ledger" | "summary";

const TABS: { id: Tab; label: string; icon: React.ElementType; description: string }[] = [
  { id: "summary", label: "Account Balances", icon: BarChart3,  description: "Current balance for every account, grouped by type" },
  { id: "trial",   label: "Trial Balance",    icon: Scale,      description: "Debit and credit balances for the selected period" },
  { id: "pnl",     label: "Profit & Loss",    icon: TrendingUp, description: "Income vs expenses over the selected period" },
  { id: "balance", label: "Balance Sheet",    icon: Building2,  description: "Assets, Liabilities and Equity at a point in time" },
  { id: "ledger",  label: "General Ledger",   icon: BookOpen,   description: "Full transaction history for a single account" },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** ISO YYYY-MM-DD for today. */
function today() { return new Date().toISOString().slice(0, 10); }

/** First day of the current month, ISO. */
function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

/** First day of the current year, ISO. */
function startOfYear(d = new Date()) {
  return `${d.getFullYear()}-01-01`;
}

/** Iterate journal lines that fall within [from, to] using a precomputed entry-date map. */
function filterLinesInRange(
  lines: JournalLine[],
  entryDateMap: Map<string, string>,
  from: string,
  to: string,
): JournalLine[] {
  return lines.filter((l) => {
    const d = entryDateMap.get(l.entry_id);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

/** Iterate journal lines on/before a given date. */
function filterLinesAsOf(
  lines: JournalLine[],
  entryDateMap: Map<string, string>,
  asOf: string,
): JournalLine[] {
  return lines.filter((l) => {
    const d = entryDateMap.get(l.entry_id);
    if (!d) return false;
    return d <= asOf;
  });
}

function netByAccount(lines: JournalLine[]): Map<string, { debit: number; credit: number }> {
  const m = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const cur = m.get(l.account_id) || { debit: 0, credit: 0 };
    cur.debit += Number(l.debit);
    cur.credit += Number(l.credit);
    m.set(l.account_id, cur);
  }
  return m;
}

/* -------------------------------------------------------------------------- */
/* MAIN                                                                        */
/* -------------------------------------------------------------------------- */
export function ReportsClient({
  accounts, lines, entries, settings,
}: {
  accounts: Account[];
  lines: JournalLine[];
  entries: JournalEntry[];
  settings: SettingsData;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const sym = currencySymbol(settings);

  // Date controls used by trial / pnl / ledger (range) and balance (as-of)
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());

  // General Ledger: which account to drill into
  const [ledgerAccountId, setLedgerAccountId] = useState<string>(accounts[0]?.id || "");

  const entryDateMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.id, e.date);
    return m;
  }, [entries]);

  const entryById = useMemo(() => {
    const m = new Map<string, JournalEntry>();
    for (const e of entries) m.set(e.id, e);
    return m;
  }, [entries]);

  function applyPreset(preset: "month" | "year" | "ytd" | "all") {
    const t = today();
    if (preset === "month") { setFrom(startOfMonth()); setTo(t); }
    else if (preset === "year") {
      const d = new Date();
      setFrom(`${d.getFullYear()}-01-01`);
      setTo(`${d.getFullYear()}-12-31`);
    }
    else if (preset === "ytd") { setFrom(startOfYear()); setTo(t); }
    else if (preset === "all") { setFrom("1970-01-01"); setTo("9999-12-31"); }
  }

  const usesRange = tab === "trial" || tab === "pnl" || tab === "ledger";
  const usesAsOf = tab === "balance";
  const activeTab = TABS.find((t) => t.id === tab)!;

  function handlePrint() {
    if (typeof window === "undefined") return;
    window.print();
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="Trial Balance · P&L · Balance Sheet · General Ledger" />

      {/* Health check: detect the most common opening-stock imbalance and offer a one-click fix */}
      <ReconciliationAlert accounts={accounts} lines={lines} sym={sym} />

      {/* Tab bar (icons + labels) */}
      <Card className="p-2 print:hidden">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-3 rounded-md text-xs font-medium transition-colors text-center",
                tab === id
                  ? "bg-blue-600 text-white"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Date controls + print */}
      <Card className="p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          {usesRange && (
            <>
              <div>
                <Label htmlFor="from">From</Label>
                <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              </div>
              <div>
                <Label htmlFor="to">To</Label>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => applyPreset("month")}>This month</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("ytd")}>YTD</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("year")}>This year</Button>
                <Button size="sm" variant="outline" onClick={() => applyPreset("all")}>All time</Button>
              </div>
            </>
          )}
          {usesAsOf && (
            <div>
              <Label htmlFor="asOf">As of date</Label>
              <Input id="asOf" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
            </div>
          )}
          {tab === "ledger" && (
            <div className="flex-1 min-w-[260px]">
              <Label htmlFor="acct">Account</Label>
              <Select id="acct" value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name} ({a.type})</option>
                ))}
              </Select>
            </div>
          )}
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
          </div>
        </div>
      </Card>

      {/* Report-specific header (visible when printing) */}
      <div className="print-only hidden">
        <div className="text-2xl font-bold text-slate-900">{settings.company?.name || "Company"}</div>
        <div className="text-lg font-semibold text-slate-900">{activeTab.label}</div>
        {usesRange && (
          <div className="text-sm text-slate-600">
            {formatDate(from)} — {formatDate(to)}
          </div>
        )}
        {usesAsOf && (
          <div className="text-sm text-slate-600">
            As of {formatDate(asOf)}
          </div>
        )}
      </div>

      {/* Reports */}
      {tab === "summary" && (
        <AccountSummary accounts={accounts} lines={lines} sym={sym} />
      )}
      {tab === "trial" && (
        <TrialBalance
          accounts={accounts}
          lines={lines}
          entryDateMap={entryDateMap}
          from={from} to={to} sym={sym}
        />
      )}
      {tab === "pnl" && (
        <ProfitLoss
          accounts={accounts}
          lines={lines}
          entryDateMap={entryDateMap}
          from={from} to={to} sym={sym}
        />
      )}
      {tab === "balance" && (
        <BalanceSheet
          accounts={accounts}
          lines={lines}
          entryDateMap={entryDateMap}
          asOf={asOf} sym={sym}
        />
      )}
      {tab === "ledger" && (
        <GeneralLedger
          accounts={accounts}
          lines={lines}
          entries={entries}
          entryById={entryById}
          accountId={ledgerAccountId}
          from={from} to={to} sym={sym}
        />
      )}

      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          @page { margin: 1.5cm; }
          .print-only { display: block !important; margin-bottom: 1rem; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* REPORT 1: Account Balances                                                  */
/* -------------------------------------------------------------------------- */
function AccountSummary({
  accounts, lines, sym,
}: { accounts: Account[]; lines: JournalLine[]; sym: string }) {
  const totals = netByAccount(lines);
  const groups: Account["type"][] = ["asset", "liability", "equity", "income", "expense"];

  function rowsFor(type: Account["type"]) {
    return accounts
      .filter((a) => a.type === type)
      .map((a) => {
        const t = totals.get(a.id) || { debit: 0, credit: 0 };
        const net = t.debit - t.credit;
        // For credit-normal accounts (liability/equity/income), balance = -net
        const isCredit = type === "liability" || type === "equity" || type === "income";
        return { ...a, balance: isCredit ? -net : net };
      });
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b">
        <div className="font-semibold text-slate-900">Account Balances</div>
        <div className="text-xs text-slate-500">All-time cumulative balance for every account</div>
      </div>
      {groups.map((g) => {
        const rows = rowsFor(g);
        if (rows.length === 0) return null;
        const total = rows.reduce((s, r) => s + r.balance, 0);
        return (
          <div key={g} className="border-t">
            <div className="px-4 py-2 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 flex justify-between">
              <span>{g}s</span>
              <span className="tabular-nums">{formatMoney(total, sym)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-slate-500 w-20">{r.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{r.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums w-40">{formatMoney(r.balance, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* REPORT 2: Trial Balance                                                     */
/* -------------------------------------------------------------------------- */
function TrialBalance({
  accounts, lines, entryDateMap, from, to, sym,
}: {
  accounts: Account[]; lines: JournalLine[];
  entryDateMap: Map<string, string>;
  from: string; to: string; sym: string;
}) {
  const inRange = filterLinesInRange(lines, entryDateMap, from, to);
  const totals = netByAccount(inRange);

  const rows = accounts.map((a) => {
    const t = totals.get(a.id) || { debit: 0, credit: 0 };
    const net = t.debit - t.credit;
    const isCredit = a.type === "liability" || a.type === "equity" || a.type === "income";
    return {
      ...a,
      debit: t.debit,
      credit: t.credit,
      balance_debit: !isCredit ? Math.max(0, net) : 0,
      balance_credit: isCredit ? Math.max(0, -net) : 0,
    };
  }).filter((r) => r.debit !== 0 || r.credit !== 0);

  const totalDebit = rows.reduce((s, r) => s + r.balance_debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.balance_credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <Card>
      <div className="p-4 border-b">
        <div className="font-semibold text-slate-900">Trial Balance</div>
        <div className="text-xs text-slate-500">{formatDate(from)} — {formatDate(to)}</div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="text-left px-4 py-2 w-20">Code</th>
            <th className="text-left px-4 py-2">Account</th>
            <th className="text-left px-4 py-2 w-28">Type</th>
            <th className="text-right px-4 py-2 w-36">Debit</th>
            <th className="text-right px-4 py-2 w-36">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="p-8 text-center text-slate-500">No journal activity in this date range.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-slate-50">
              <td className="px-4 py-2 font-mono text-slate-600">{r.code}</td>
              <td className="px-4 py-2 font-medium text-slate-900">{r.name}</td>
              <td className="px-4 py-2 capitalize text-slate-500 text-xs">{r.type}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {r.balance_debit > 0 ? formatMoney(r.balance_debit, sym) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {r.balance_credit > 0 ? formatMoney(r.balance_credit, sym) : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="px-4 py-2.5" colSpan={3}>Totals</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(totalDebit, sym)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(totalCredit, sym)}</td>
          </tr>
          <tr className={cn("border-t font-semibold", balanced ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
            <td className="px-4 py-2.5" colSpan={3}>{balanced ? "Balanced ✓" : "Out of balance"}</td>
            <td className="px-4 py-2.5 text-right tabular-nums" colSpan={2}>
              {balanced ? formatMoney(0, sym) : formatMoney(Math.abs(totalDebit - totalCredit), sym)}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* REPORT 3: Profit & Loss                                                     */
/* -------------------------------------------------------------------------- */
function ProfitLoss({
  accounts, lines, entryDateMap, from, to, sym,
}: {
  accounts: Account[]; lines: JournalLine[];
  entryDateMap: Map<string, string>;
  from: string; to: string; sym: string;
}) {
  const inRange = filterLinesInRange(lines, entryDateMap, from, to);
  const totals = netByAccount(inRange);

  function rowsFor(type: "income" | "expense") {
    return accounts
      .filter((a) => a.type === type)
      .map((a) => {
        const t = totals.get(a.id) || { debit: 0, credit: 0 };
        const amount = type === "income" ? (t.credit - t.debit) : (t.debit - t.credit);
        return { ...a, amount };
      })
      .filter((r) => Math.abs(r.amount) > 0.001);
  }

  const income = rowsFor("income");
  const expense = rowsFor("expense");
  const incomeTotal = income.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = expense.reduce((s, r) => s + r.amount, 0);
  const grossProfit = incomeTotal; // Without COGS separation
  const netProfit = incomeTotal - expenseTotal;

  return (
    <Card>
      <div className="p-4 border-b">
        <div className="font-semibold text-slate-900">Profit &amp; Loss</div>
        <div className="text-xs text-slate-500">{formatDate(from)} — {formatDate(to)}</div>
      </div>
      <div className="p-5 space-y-6">
        <Section
          title="Income"
          rows={income}
          total={incomeTotal}
          totalLabel="Total Income"
          sym={sym}
          accentColor="emerald"
        />
        <Section
          title="Expenses"
          rows={expense}
          total={expenseTotal}
          totalLabel="Total Expenses"
          sym={sym}
          accentColor="red"
        />
        <div className={cn(
          "flex justify-between items-center py-3 px-4 rounded-md text-base font-bold border-2",
          netProfit >= 0
            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : "bg-red-50 text-red-800 border-red-200"
        )}>
          <span>Net {netProfit >= 0 ? "Profit" : "Loss"}</span>
          <span className="tabular-nums text-lg">{formatMoney(Math.abs(netProfit), sym)}</span>
        </div>
        {grossProfit > 0 && (
          <div className="text-xs text-slate-500 text-right">
            Margin: {((netProfit / grossProfit) * 100).toFixed(1)}%
          </div>
        )}
      </div>
    </Card>
  );
}

function Section({
  title, rows, total, totalLabel, sym, accentColor,
}: {
  title: string;
  rows: { id: string; code: string; name: string; amount: number }[];
  total: number;
  totalLabel: string;
  sym: string;
  accentColor: "emerald" | "red";
}) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2 pb-1 border-b-2 border-slate-200">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500 py-2 italic">No {title.toLowerCase()} recorded</div>
      ) : (
        <div className="space-y-0.5">
          {rows.map((r) => (
            <div key={r.id} className="flex justify-between py-1.5 px-2 hover:bg-slate-50 rounded text-sm">
              <span><span className="text-slate-500 font-mono mr-2">{r.code}</span>{r.name}</span>
              <span className="tabular-nums font-medium">{formatMoney(r.amount, sym)}</span>
            </div>
          ))}
        </div>
      )}
      <div className={cn(
        "flex justify-between py-2 mt-2 font-bold border-t-2 border-slate-300",
        accentColor === "emerald" ? "text-emerald-800" : "text-red-800",
      )}>
        <span>{totalLabel}</span>
        <span className="tabular-nums">{formatMoney(total, sym)}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* REPORT 4: Balance Sheet                                                     */
/* -------------------------------------------------------------------------- */
function BalanceSheet({
  accounts, lines, entryDateMap, asOf, sym,
}: {
  accounts: Account[]; lines: JournalLine[];
  entryDateMap: Map<string, string>;
  asOf: string; sym: string;
}) {
  const cumulative = filterLinesAsOf(lines, entryDateMap, asOf);
  const totals = netByAccount(cumulative);

  function rowsFor(type: Account["type"]) {
    return accounts
      .filter((a) => a.type === type)
      .map((a) => {
        const t = totals.get(a.id) || { debit: 0, credit: 0 };
        const net = t.debit - t.credit;
        const isCredit = type === "liability" || type === "equity" || type === "income";
        return { ...a, balance: isCredit ? -net : net };
      })
      .filter((r) => Math.abs(r.balance) > 0.001);
  }

  const assets = rowsFor("asset");
  const liabilities = rowsFor("liability");
  const equity = rowsFor("equity");

  // Retained Earnings = cumulative (Income - Expense) up to asOf
  const incomeRows = rowsFor("income");
  const expenseRows = rowsFor("expense");
  const incomeTotal = incomeRows.reduce((s, r) => s + r.balance, 0);
  const expenseTotal = expenseRows.reduce((s, r) => s + r.balance, 0);
  const retainedEarnings = incomeTotal - expenseTotal;

  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquity = equity.reduce((s, r) => s + r.balance, 0) + retainedEarnings;
  const totalLiabAndEquity = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - totalLiabAndEquity) < 0.01;

  return (
    <Card>
      <div className="p-4 border-b">
        <div className="font-semibold text-slate-900">Balance Sheet</div>
        <div className="text-xs text-slate-500">As of {formatDate(asOf)}</div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x">
        {/* ASSETS */}
        <div className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-3 pb-1 border-b-2 border-slate-200">
            Assets
          </div>
          {assets.length === 0 ? (
            <div className="text-sm text-slate-500 italic py-2">No asset balances</div>
          ) : (
            <div className="space-y-0.5">
              {assets.map((r) => (
                <div key={r.id} className="flex justify-between py-1.5 px-2 hover:bg-slate-50 rounded text-sm">
                  <span><span className="text-slate-500 font-mono mr-2">{r.code}</span>{r.name}</span>
                  <span className="tabular-nums font-medium">{formatMoney(r.balance, sym)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between py-3 mt-3 font-bold text-base border-t-2 border-slate-300 bg-blue-50 -mx-5 px-7">
            <span>TOTAL ASSETS</span>
            <span className="tabular-nums">{formatMoney(totalAssets, sym)}</span>
          </div>
        </div>

        {/* LIABILITIES + EQUITY */}
        <div className="p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-3 pb-1 border-b-2 border-slate-200">
            Liabilities
          </div>
          {liabilities.length === 0 ? (
            <div className="text-sm text-slate-500 italic py-2">No liability balances</div>
          ) : (
            <div className="space-y-0.5">
              {liabilities.map((r) => (
                <div key={r.id} className="flex justify-between py-1.5 px-2 hover:bg-slate-50 rounded text-sm">
                  <span><span className="text-slate-500 font-mono mr-2">{r.code}</span>{r.name}</span>
                  <span className="tabular-nums font-medium">{formatMoney(r.balance, sym)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between py-1.5 mt-1 font-semibold text-sm border-t border-slate-300">
            <span>Total Liabilities</span>
            <span className="tabular-nums">{formatMoney(totalLiabilities, sym)}</span>
          </div>

          <div className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-3 mt-6 pb-1 border-b-2 border-slate-200">
            Equity
          </div>
          <div className="space-y-0.5">
            {equity.map((r) => (
              <div key={r.id} className="flex justify-between py-1.5 px-2 hover:bg-slate-50 rounded text-sm">
                <span><span className="text-slate-500 font-mono mr-2">{r.code}</span>{r.name}</span>
                <span className="tabular-nums font-medium">{formatMoney(r.balance, sym)}</span>
              </div>
            ))}
            <div className="flex justify-between py-1.5 px-2 hover:bg-slate-50 rounded text-sm">
              <span className="italic text-slate-700">Retained Earnings (Income − Expenses to date)</span>
              <span className={cn("tabular-nums font-medium", retainedEarnings < 0 && "text-red-700")}>
                {formatMoney(retainedEarnings, sym)}
              </span>
            </div>
          </div>
          <div className="flex justify-between py-1.5 mt-1 font-semibold text-sm border-t border-slate-300">
            <span>Total Equity</span>
            <span className="tabular-nums">{formatMoney(totalEquity, sym)}</span>
          </div>

          <div className="flex justify-between py-3 mt-3 font-bold text-base border-t-2 border-slate-300 bg-blue-50 -mx-5 px-7">
            <span>TOTAL LIABILITIES + EQUITY</span>
            <span className="tabular-nums">{formatMoney(totalLiabAndEquity, sym)}</span>
          </div>
        </div>
      </div>

      <div className={cn(
        "p-3 border-t flex items-center justify-between gap-3 flex-wrap",
        balanced ? "bg-emerald-50" : "bg-red-50",
      )}>
        <span className={cn("text-sm font-medium", balanced ? "text-emerald-800" : "text-red-800")}>
          {balanced
            ? "✓ Balance Sheet balances: Assets = Liabilities + Equity"
            : `⚠ Out of balance by ${formatMoney(Math.abs(totalAssets - totalLiabAndEquity), sym)}`}
        </span>
        <ReconcileOpeningStockButton />
      </div>
    </Card>
  );
}

/**
 * Top-of-page banner that detects the most common books-imbalance: the
 * Inventory Adjustment account (5700) carrying a large credit balance —
 * which happens when opening stock was wrongly posted to it as a negative
 * expense instead of an Owner Equity contribution. Surfaces the Reconcile
 * action on every report tab so the user can fix it from wherever they
 * spot the symptom.
 */
function ReconciliationAlert({
  accounts, lines, sym,
}: { accounts: Account[]; lines: JournalLine[]; sym: string }) {
  const invAdj = accounts.find((a) => a.code === "5700");
  if (!invAdj) return null;
  // Net = debit − credit. Negative (credits > debits) on an EXPENSE account
  // signals the bug: opening stock was credited here instead of to Equity.
  const totals = netByAccount(lines);
  const t = totals.get(invAdj.id) || { debit: 0, credit: 0 };
  const net = t.debit - t.credit;
  // Only show if there's a meaningful credit balance (>1 unit) to fix.
  if (net >= -1) return null;
  const creditBalance = -net;
  return (
    <Card className="border-amber-300 bg-amber-50 p-4 print:hidden">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-shrink-0 mt-0.5">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-[280px]">
          <div className="font-semibold text-amber-900">Books imbalance detected</div>
          <p className="text-sm text-amber-800 mt-1">
            <b>Inventory Adjustment (5700)</b> has a credit balance of{" "}
            <b className="tabular-nums">{formatMoney(creditBalance, sym)}</b>. This means historical
            opening stock was posted here (an expense account) instead of to{" "}
            <b>Owner Equity (3000)</b> — which inflates Net Profit and breaks the
            balance sheet by the same amount. Click <b>Reconcile</b> to reclassify these entries.
          </p>
          <p className="text-xs text-amber-700 mt-2 italic">
            Safe to run · idempotent · posts a correction journal per affected product.
          </p>
        </div>
        <div className="flex-shrink-0">
          <ReconcileOpeningStockButton />
        </div>
      </div>
    </Card>
  );
}

/**
 * One-click fix for the historical bug where opening stock was posted to
 * the inventory-adjustment expense account (5700) instead of Owner Equity
 * (3000). Idempotent — safe to click even if already reconciled.
 */
function ReconcileOpeningStockButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run() {
    if (!confirm(
      "Reclassify every opening-stock journal that was posted to " +
      "Inventory Adjustment (5700) over to Owner Equity (3000)?\n\n" +
      "This adds a correction journal per affected product. It's safe " +
      "to re-run — already-reclassified rows are skipped."
    )) return;
    start(async () => {
      const r = await reconcileOpeningStockEquity();
      if (!r.ok) { toast.error(r.error || "Reconciliation failed"); return; }
      if ((r.fixed ?? 0) === 0) {
        toast.success("Nothing to reconcile — opening stock already posts to Owner Equity.");
      } else {
        toast.success(`Reclassified ${r.fixed} opening-stock entry(ies) totalling ${(r.total ?? 0).toFixed(2)}`);
      }
      router.refresh();
    });
  }
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={pending}>
      {pending
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <Wrench className="h-4 w-4" />}
      Reconcile opening stock
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* REPORT 5: General Ledger (per-account transaction list)                     */
/* -------------------------------------------------------------------------- */
function GeneralLedger({
  accounts, lines, entryById, accountId, from, to, sym,
}: {
  accounts: Account[];
  lines: JournalLine[];
  entries: JournalEntry[];
  entryById: Map<string, JournalEntry>;
  accountId: string;
  from: string; to: string; sym: string;
}) {
  const account = accounts.find((a) => a.id === accountId);

  // Opening balance: net of all lines BEFORE `from`
  const openingLines = lines.filter((l) => {
    if (l.account_id !== accountId) return false;
    const d = entryById.get(l.entry_id)?.date;
    return d != null && d < from;
  });
  const openingNet = openingLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

  // In-range lines
  const inRange = lines
    .filter((l) => {
      if (l.account_id !== accountId) return false;
      const d = entryById.get(l.entry_id)?.date;
      return d != null && d >= from && d <= to;
    })
    .map((l) => ({ line: l, entry: entryById.get(l.entry_id)! }))
    .filter((x) => x.entry)
    .sort((a, b) => {
      const dc = a.entry.date.localeCompare(b.entry.date);
      if (dc !== 0) return dc;
      return (a.entry.entry_no || "").localeCompare(b.entry.entry_no || "");
    });

  // Running balance (debit-positive convention for the table; we'll display
  // it sign-aware based on account type)
  let running = openingNet;
  const isCredit = account?.type === "liability" || account?.type === "equity" || account?.type === "income";
  const fmtBalance = (n: number) => formatMoney(isCredit ? -n : n, sym);

  const totalDebit = inRange.reduce((s, x) => s + Number(x.line.debit), 0);
  const totalCredit = inRange.reduce((s, x) => s + Number(x.line.credit), 0);
  const periodChange = totalDebit - totalCredit;
  const closingNet = openingNet + periodChange;

  return (
    <Card>
      <div className="p-4 border-b">
        <div className="font-semibold text-slate-900">
          General Ledger {account && <>· <span className="font-mono">{account.code}</span> {account.name}</>}
        </div>
        <div className="text-xs text-slate-500">{formatDate(from)} — {formatDate(to)}</div>
      </div>

      {!account ? (
        <div className="p-8 text-center text-slate-500">Select an account above to view its ledger.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 w-28">Date</th>
              <th className="text-left px-3 py-2 w-28">Entry #</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2 w-32">Debit</th>
              <th className="text-right px-3 py-2 w-32">Credit</th>
              <th className="text-right px-3 py-2 w-36">Balance</th>
            </tr>
          </thead>
          <tbody>
            {/* Opening balance row */}
            <tr className="bg-slate-50 border-t italic">
              <td className="px-3 py-2 text-slate-500" colSpan={3}>Opening balance {from !== "1970-01-01" && <>as of {formatDate(from)}</>}</td>
              <td colSpan={2}></td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtBalance(openingNet)}</td>
            </tr>
            {inRange.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-500">No transactions in this period.</td></tr>
            ) : inRange.map(({ line, entry }) => {
              running += Number(line.debit) - Number(line.credit);
              const desc = line.description || entry.description || entry.source_type;
              return (
                <tr key={line.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-600">{formatDate(entry.date)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{entry.entry_no}</td>
                  <td className="px-3 py-2 text-slate-900">{desc}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(line.debit) > 0 ? formatMoney(line.debit, sym) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(line.credit) > 0 ? formatMoney(line.credit, sym) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtBalance(running)}</td>
                </tr>
              );
            })}
            {/* Period totals + closing */}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={3}>Period totals</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalDebit, sym)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalCredit, sym)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {periodChange >= 0 ? "+" : ""}{fmtBalance(Math.abs(periodChange)).replace(/^/, periodChange < 0 ? "-" : "")}
              </td>
            </tr>
            <tr className="bg-blue-50 font-bold">
              <td className="px-3 py-2.5" colSpan={5}>Closing balance as of {formatDate(to)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-blue-900">{fmtBalance(closingNet)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}
