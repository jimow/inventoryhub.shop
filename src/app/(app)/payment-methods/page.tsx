import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { fundsAccounts } from "@/lib/accounting";
import { PaymentMethodsClient } from "./payment-methods-client";
import type { PaymentMethod, BankAccount, Account } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PaymentMethodsPage() {
  await requireViewPermission("accounting");
  const { permissions } = await getCurrentSession();
  const supabase = await createClient();
  const [{ data: methods }, { data: bankAccounts }, { data: assetAccounts }, balances] = await Promise.all([
    supabase.from("payment_methods").select("*").order("name"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
    supabase.from("accounts").select("id, code, name, type").eq("type", "asset").eq("is_active", true).order("code"),
    fundsAccounts(),
  ]);
  const balanceByMethod: Record<string, number> = {};
  for (const f of balances) balanceByMethod[f.id] = f.balance;

  return (
    <PaymentMethodsClient
      methods={(methods as PaymentMethod[]) || []}
      bankAccounts={(bankAccounts as BankAccount[]) || []}
      assetAccounts={(assetAccounts as Pick<Account, "id" | "code" | "name" | "type">[]) || []}
      balanceByMethod={balanceByMethod}
      permissions={permissions}
    />
  );
}
