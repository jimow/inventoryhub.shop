import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { ChartOfAccountsClient } from "./chart-client";
import type { Account } from "@/lib/types";

export default async function ChartOfAccountsPage() {
  await requireViewPermission("accounting");
  const { permissions } = await getCurrentSession();
  const admin = createServiceClient();
  const tid = currentTenantId();
  let accountsQ = admin.from("accounts").select("*").order("code");
  if (tid) accountsQ = accountsQ.eq("tenant_id", tid);
  let linesQ = admin.from("journal_lines").select("account_id, debit, credit");
  if (tid) linesQ = linesQ.eq("tenant_id", tid);
  const [{ data: accounts }, { data: lines }] = await Promise.all([accountsQ, linesQ]);

  const balances = new Map<string, number>();
  for (const l of lines || []) {
    balances.set(l.account_id, (balances.get(l.account_id) || 0) + Number(l.debit) - Number(l.credit));
  }
  const enriched = ((accounts as Account[]) || []).map((a) => ({
    ...a, balance: balances.get(a.id) || 0,
  }));
  return <ChartOfAccountsClient accounts={enriched} permissions={permissions} />;
}
