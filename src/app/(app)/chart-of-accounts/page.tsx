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

  // Sum debits and credits per account once, then derive balance + In/Out.
  const debitByAcct = new Map<string, number>();
  const creditByAcct = new Map<string, number>();
  for (const l of lines || []) {
    debitByAcct.set(l.account_id, (debitByAcct.get(l.account_id) || 0) + Number(l.debit));
    creditByAcct.set(l.account_id, (creditByAcct.get(l.account_id) || 0) + Number(l.credit));
  }
  const enriched = ((accounts as Account[]) || []).map((a) => {
    const debit = debitByAcct.get(a.id) || 0;
    const credit = creditByAcct.get(a.id) || 0;
    // "In" = the side that increases this account's natural balance; "Out" = the
    // side that decreases it. Credit-natured accounts increase with credits.
    const creditNatured = a.type === "liability" || a.type === "equity" || a.type === "income";
    const inTotal = creditNatured ? credit : debit;
    const outTotal = creditNatured ? debit : credit;
    return { ...a, balance: debit - credit, inTotal, outTotal };
  });
  return <ChartOfAccountsClient accounts={enriched} permissions={permissions} />;
}
