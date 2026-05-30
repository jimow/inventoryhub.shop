"use client";

import { useMemo } from "react";
import {
  Receipt, ShoppingCart, Wallet, FileEdit,
  Layers, AlertCircle, CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils";
import type { JournalEntry, JournalLine, Account } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* TYPES                                                                       */
/* -------------------------------------------------------------------------- */
type SourceType = "manual" | "sale" | "purchase" | "payment";

type TxnGroup = {
  /** DataTable requires `id` — use the group key so React can dedupe rows. */
  id: string;
  source_type: SourceType;
  source_id: string | null;
  date: string;
  entries: JournalEntry[];
  lines: JournalLine[];
  primaryEntry: JournalEntry;
  /** The "main" amount — typically the doc total (largest entry's debit). */
  primaryAmount: number;
  /** Sum of all debits across every entry in the group. */
  totalMovement: number;
  description: string;
};

const SOURCE_CONFIG: Record<
  SourceType,
  { variant: "info" | "success" | "warning" | "secondary"; label: string; icon: React.ElementType }
> = {
  manual:   { variant: "secondary", label: "Manual",   icon: FileEdit },
  sale:     { variant: "success",   label: "Sale",     icon: Receipt },
  purchase: { variant: "warning",   label: "Purchase", icon: ShoppingCart },
  payment:  { variant: "info",      label: "Payment",  icon: Wallet },
};

/**
 * Bucket journal entries that share a source document into one logical
 * transaction. For example a cash sale produces THREE entries:
 *   1. Sale journal     (Dr AR / Cr Sales / Cr Tax)
 *   2. COGS journal     (Dr COGS / Cr Inventory)
 *   3. Receipt journal  (Dr Cash / Cr AR)
 * The first two share `source_type=sale, source_id=sale.id` and get grouped.
 * The receipt is its own group keyed by the payment id.
 * Manual entries (no source_id) are always their own group.
 */
function buildGroups(entries: JournalEntry[], lines: JournalLine[]): TxnGroup[] {
  const linesByEntry = new Map<string, JournalLine[]>();
  for (const l of lines) {
    const arr = linesByEntry.get(l.entry_id) || [];
    arr.push(l);
    linesByEntry.set(l.entry_id, arr);
  }

  const map = new Map<string, TxnGroup>();
  for (const e of entries) {
    const key = (e.source_type === "manual" || !e.source_id)
      ? `entry:${e.id}`
      : `${e.source_type}:${e.source_id}`;

    const myLines = linesByEntry.get(e.id) || [];
    const debit = myLines.reduce((s, l) => s + Number(l.debit), 0);

    let g = map.get(key);
    if (!g) {
      g = {
        id: key,
        source_type: e.source_type as SourceType,
        source_id: e.source_id,
        date: e.date,
        entries: [],
        lines: [],
        primaryEntry: e,
        primaryAmount: debit,
        totalMovement: 0,
        description: e.description || "",
      };
      map.set(key, g);
    }
    g.entries.push(e);
    g.lines.push(...myLines);
    g.totalMovement += debit;
    // Keep the entry with the largest debit as "primary" — that's usually
    // the head of the transaction (Sale before COGS, etc.)
    if (debit > g.primaryAmount) {
      g.primaryAmount = debit;
      g.primaryEntry = e;
      g.description = e.description || g.description;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const t = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (t !== 0) return t;
    return (b.primaryEntry.entry_no || "").localeCompare(a.primaryEntry.entry_no || "");
  });
}

/* -------------------------------------------------------------------------- */
/* MAIN                                                                        */
/* -------------------------------------------------------------------------- */
export function JournalClient({
  entries, totalCount, lines, accounts,
}: {
  entries: JournalEntry[];
  totalCount: number;
  lines: JournalLine[];
  accounts: Account[];
}) {
  const acctName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} — ${a.name}` : id;
  };

  const groups = useMemo(() => buildGroups(entries, lines), [entries, lines]);

  const columns: Column<TxnGroup>[] = [
    {
      key: "date", label: "Date & time", className: "w-[150px] text-slate-600 whitespace-nowrap",
      render: (r) => formatDateTime(r.primaryEntry?.created_at ?? r.date),
    },
    {
      key: "ref", label: "Reference", className: "w-[160px]",
      render: (r) => (
        <div>
          <div className="font-mono text-sm font-medium text-slate-900">{r.primaryEntry.entry_no}</div>
          {r.entries.length > 1 && (
            <div className="text-[11px] text-slate-500 inline-flex items-center gap-0.5 mt-0.5">
              <Layers className="h-2.5 w-2.5" />
              {r.entries.length} entries
            </div>
          )}
        </div>
      ),
    },
    {
      key: "source_type", label: "Type", className: "w-[120px]",
      render: (r) => <SourceBadge type={r.source_type} />,
    },
    {
      key: "description", label: "Description",
      render: (r) => <span className="text-slate-900">{r.description || "—"}</span>,
    },
    {
      key: "amount", label: "Amount", className: "w-[140px] text-right",
      render: (r) => (
        <span className="font-semibold tabular-nums text-slate-900">
          {formatMoney(r.primaryAmount)}
        </span>
      ),
    },
  ];

  const filters: FilterDef[] = [{
    key: "source_type", label: "Source",
    options: [
      { value: "manual",   label: "Manual" },
      { value: "sale",     label: "Sale" },
      { value: "purchase", label: "Purchase" },
      { value: "payment",  label: "Payment" },
    ],
  }];

  return (
    <div>
      <PageHeader
        title="Journal"
        description="Double-entry transactions, grouped by source document. Click any row to expand."
      />

      <DataTable<TxnGroup>
        columns={columns}
        data={groups}
        totalCount={totalCount}
        searchPlaceholder="Search by entry # or description..."
        filters={filters}
        expandable={{
          rowClickExpands: true,
          singleOpen: true,
          render: (row) => <TransactionDetail group={row} acctName={acctName} />,
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* BADGES + SECTIONS                                                           */
/* -------------------------------------------------------------------------- */
function SourceBadge({ type }: { type: SourceType }) {
  const cfg = SOURCE_CONFIG[type];
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
      {children}
    </h3>
  );
}

/* -------------------------------------------------------------------------- */
/* TRANSACTION DETAIL — rendered INLINE inside the table's expand drawer       */
/* -------------------------------------------------------------------------- */
function TransactionDetail({
  group, acctName,
}: {
  group: TxnGroup;
  acctName: (id: string) => string;
}) {
  // Per-account net effect across ALL entries in the group (the "consolidated"
  // view). Positive = net debit; negative = net credit.
  const netByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of group.lines) {
      m.set(l.account_id, (m.get(l.account_id) || 0) + Number(l.debit) - Number(l.credit));
    }
    return Array.from(m.entries())
      .map(([id, net]) => ({ id, net }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [group.lines]);

  const totalDebit = group.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = group.lines.reduce((s, l) => s + Number(l.credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-5">
      {/* Compact header summarising the transaction */}
      <div className="flex items-start justify-between gap-4 flex-wrap pb-3 border-b">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">
            Transaction
          </div>
          <div className="font-medium text-slate-900">
            {group.description || "—"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {formatDate(group.date)}
            {group.entries.length > 1 && (
              <> · <Layers className="inline h-3 w-3 mr-0.5 -mt-0.5" />{group.entries.length} journal entries</>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Total Movement</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums">{formatMoney(totalDebit)}</div>
        </div>
      </div>

      {/* Balance check */}
      {balanced ? (
        <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>Balanced: total debits equal total credits ({formatMoney(totalDebit)})</span>
        </div>
      ) : (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>
            Does not balance: Dr {formatMoney(totalDebit)} vs Cr {formatMoney(totalCredit)}
            {" · "}
            <span className="font-semibold">Diff {formatMoney(Math.abs(totalDebit - totalCredit))}</span>
          </span>
        </div>
      )}

      {/* Two-column layout: net effect (left) + individual entries (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Net effect by account (consolidated T-account view) */}
        <section>
          <SectionTitle>Net Effect by Account</SectionTitle>
          <div className="border rounded-lg overflow-hidden bg-white">
            <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-3 py-2 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <div>Account</div>
              <div className="text-right">Debit</div>
              <div className="text-right">Credit</div>
            </div>
            {netByAccount.map(({ id, net }) => (
              <div
                key={id}
                className="grid grid-cols-[1fr_100px_100px] gap-2 px-3 py-2 items-center border-t bg-white hover:bg-slate-50"
              >
                <div className="font-medium text-slate-900 text-sm truncate" title={acctName(id)}>
                  {acctName(id)}
                </div>
                <div className="text-right tabular-nums text-sm">
                  {net > 0 ? (
                    <span className="font-semibold text-slate-900">{formatMoney(net)}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </div>
                <div className="text-right tabular-nums text-sm">
                  {net < 0 ? (
                    <span className="font-semibold text-slate-900">{formatMoney(-net)}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-3 py-2 items-center border-t bg-slate-50 font-bold text-sm">
              <div className="text-right uppercase tracking-wide text-[11px] text-slate-600">Totals</div>
              <div className="text-right tabular-nums">{formatMoney(totalDebit)}</div>
              <div className="text-right tabular-nums">{formatMoney(totalCredit)}</div>
            </div>
          </div>
        </section>

        {/* Individual entries */}
        <section>
          <SectionTitle>
            {group.entries.length > 1
              ? `Journal Entries (${group.entries.length})`
              : "Journal Entry"}
          </SectionTitle>
          <div className="space-y-3">
            {group.entries.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                lines={group.lines.filter((l) => l.entry_id === e.id)}
                acctName={acctName}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function EntryCard({
  entry, lines, acctName,
}: {
  entry: JournalEntry;
  lines: JournalLine[];
  acctName: (id: string) => string;
}) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <div className="px-3 py-2 bg-slate-50 border-b flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold text-slate-900">{entry.entry_no}</div>
          <div className="text-xs text-slate-500 truncate">{entry.description || "—"}</div>
        </div>
        <div className="text-xs text-slate-600 tabular-nums whitespace-nowrap ml-3">
          {formatMoney(totalDebit)}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left p-2 pl-3 font-semibold">Account</th>
            <th className="text-right p-2 w-28 font-semibold">Debit</th>
            <th className="text-right p-2 w-28 pr-3 font-semibold">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t">
              <td className="p-2 pl-3">
                <div className="font-medium text-slate-900">{acctName(l.account_id)}</div>
                {l.description && (
                  <div className="text-xs text-slate-500 mt-0.5">{l.description}</div>
                )}
              </td>
              <td className="p-2 text-right tabular-nums">
                {Number(l.debit) > 0 ? (
                  <span className="font-medium text-slate-900">{formatMoney(l.debit)}</span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              <td className="p-2 pr-3 text-right tabular-nums">
                {Number(l.credit) > 0 ? (
                  <span className="font-medium text-slate-900">{formatMoney(l.credit)}</span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t bg-slate-50">
            <td className="p-2 pl-3 text-right text-[11px] uppercase tracking-wide font-semibold text-slate-600">
              Subtotal
            </td>
            <td className="p-2 text-right tabular-nums font-bold">{formatMoney(totalDebit)}</td>
            <td className="p-2 pr-3 text-right tabular-nums font-bold">{formatMoney(totalCredit)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
