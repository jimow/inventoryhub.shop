import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { ReportsClient } from "./reports-client";
import type { Account, JournalLine, JournalEntry } from "@/lib/types";

export default async function ReportsPage() {
  await requireViewPermission("accounting");
  const admin = createServiceClient();
  // Service role bypasses RLS — scope every read to this tenant.
  const tid = currentTenantId();
  let accountsQ = admin.from("accounts").select("*").order("code");
  let linesQ = admin.from("journal_lines").select("*");
  let entriesQ = admin.from("journal_entries").select("id, date, entry_no, description, source_type");
  let banksQ = admin.from("bank_accounts").select("opening_balance, account_id");
  if (tid) {
    accountsQ = accountsQ.eq("tenant_id", tid);
    linesQ = linesQ.eq("tenant_id", tid);
    entriesQ = entriesQ.eq("tenant_id", tid);
    banksQ = banksQ.eq("tenant_id", tid);
  }
  const [{ data: accounts }, { data: lines }, { data: entries }, { data: banks }, settings] = await Promise.all([
    accountsQ, linesQ, entriesQ, banksQ, getSettings(),
  ]);
  // Bank opening balances live outside the journal — pass them through so the
  // Balance Sheet includes them (and stays consistent with the cash figure the
  // payment screens / Dashboard show).
  const bankOpenings = (banks || [])
    .filter((b) => b.account_id && Number(b.opening_balance || 0) !== 0)
    .map((b) => ({ account_id: b.account_id as string, opening_balance: Number(b.opening_balance || 0) }));
  return (
    <ReportsClient
      accounts={(accounts as Account[]) || []}
      lines={(lines as JournalLine[]) || []}
      entries={(entries as JournalEntry[]) || []}
      bankOpenings={bankOpenings}
      settings={settings}
    />
  );
}
