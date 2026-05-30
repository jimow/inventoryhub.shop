import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { BankAccountsClient } from "./bank-accounts-client";
import type { BankAccount, Account } from "@/lib/types";

export default async function BankAccountsPage() {
  await requireViewPermission("accounting");
  const { permissions } = await getCurrentSession();
  const supabase = await createClient();
  const [{ data: bankAccounts }, { data: accounts }, settings] = await Promise.all([
    supabase.from("bank_accounts").select("*").order("name"),
    supabase.from("accounts").select("*").eq("type", "asset").eq("is_active", true).order("code"),
    getSettings(),
  ]);
  const list = (bankAccounts as BankAccount[]) || [];

  // Batch-fetch all journal lines for linked accounts in one query instead of N per-account calls
  const linkedAccountIds = list.map((b) => b.account_id).filter(Boolean) as string[];
  const admin = createServiceClient();
  const { data: lines } = linkedAccountIds.length
    ? await admin.from("journal_lines").select("account_id, debit, credit").in("account_id", linkedAccountIds)
    : { data: [] };

  const lineBalances = new Map<string, number>();
  for (const l of lines || []) {
    lineBalances.set(l.account_id, (lineBalances.get(l.account_id) || 0) + Number(l.debit) - Number(l.credit));
  }
  const withBalances = list.map((b) => ({
    ...b,
    current_balance: Number(b.opening_balance || 0) + (b.account_id ? (lineBalances.get(b.account_id) || 0) : 0),
  }));

  return (
    <BankAccountsClient
      bankAccounts={withBalances}
      assetAccounts={(accounts as Account[]) || []}
      settings={settings}
      permissions={permissions}
    />
  );
}
