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
  if (tid) {
    accountsQ = accountsQ.eq("tenant_id", tid);
    linesQ = linesQ.eq("tenant_id", tid);
    entriesQ = entriesQ.eq("tenant_id", tid);
  }
  const [{ data: accounts }, { data: lines }, { data: entries }, settings] = await Promise.all([
    accountsQ, linesQ, entriesQ, getSettings(),
  ]);
  return (
    <ReportsClient
      accounts={(accounts as Account[]) || []}
      lines={(lines as JournalLine[]) || []}
      entries={(entries as JournalEntry[]) || []}
      settings={settings}
    />
  );
}
