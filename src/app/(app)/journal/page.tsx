import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { JournalClient } from "./journal-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { JournalEntry, JournalLine, Account } from "@/lib/types";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("accounting");
  await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["source_type"]);
  const { from, to } = listRange(params);

  const admin = createServiceClient();
  // Service role bypasses RLS — scope every read to this tenant.
  const tid = currentTenantId();
  let query = admin.from("journal_entries").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (tid) query = query.eq("tenant_id", tid);
  if (params.q) query = query.or(`entry_no.ilike.%${params.q}%,description.ilike.%${params.q}%`);
  if (params.filters.source_type) query = query.eq("source_type", params.filters.source_type);

  let accountsQuery = admin.from("accounts").select("*").order("code");
  if (tid) accountsQuery = accountsQuery.eq("tenant_id", tid);

  // Fetch entries and accounts in parallel; lines depend on entry ids so come after
  const [{ data: pageEntries, count }, { data: accounts }] = await Promise.all([
    query,
    accountsQuery,
  ]);

  // Pull in "sibling" entries that share a source (e.g. Sale + COGS for one
  // invoice) so a transaction's entries never get split across pages.
  // We do this for sale/purchase/payment with a source_id — manual entries
  // are always their own group.
  const pageList = (pageEntries as JournalEntry[]) || [];
  const sourceKeys = pageList
    .filter((e) => e.source_id && e.source_type !== "manual")
    .map((e) => `${e.source_type}:${e.source_id}`);
  const uniqueSourceKeys = Array.from(new Set(sourceKeys));

  let allEntries: JournalEntry[] = pageList;
  if (uniqueSourceKeys.length > 0) {
    // Group by source_type to do one .in() per type
    const bySourceType = new Map<string, string[]>();
    for (const k of uniqueSourceKeys) {
      const [st, sid] = k.split(":");
      const arr = bySourceType.get(st) || [];
      arr.push(sid);
      bySourceType.set(st, arr);
    }
    const siblingFetches = Array.from(bySourceType.entries()).map(([st, sids]) => {
      let q = admin.from("journal_entries").select("*").eq("source_type", st).in("source_id", sids);
      if (tid) q = q.eq("tenant_id", tid);
      return q;
    });
    const siblingResults = await Promise.all(siblingFetches);
    const siblingMap = new Map<string, JournalEntry>();
    for (const e of pageList) siblingMap.set(e.id, e);
    for (const r of siblingResults) {
      for (const e of (r.data as JournalEntry[]) || []) siblingMap.set(e.id, e);
    }
    allEntries = Array.from(siblingMap.values());
  }

  const ids = allEntries.map((e) => e.id);
  const { data: lines } = ids.length
    ? await admin.from("journal_lines").select("*").in("entry_id", ids)
    : { data: [] as JournalLine[] };

  return (
    <JournalClient
      entries={allEntries}
      totalCount={count || 0}
      lines={(lines as JournalLine[]) || []}
      accounts={(accounts as Account[]) || []}
    />
  );
}
