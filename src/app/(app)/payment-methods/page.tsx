import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { PaymentMethodsClient } from "./payment-methods-client";
import type { PaymentMethod, BankAccount } from "@/lib/types";

export default async function PaymentMethodsPage() {
  await requireViewPermission("accounting");
  const { permissions } = await getCurrentSession();
  const supabase = await createClient();
  const [{ data: methods }, { data: bankAccounts }] = await Promise.all([
    supabase.from("payment_methods").select("*").order("name"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
  ]);
  return (
    <PaymentMethodsClient
      methods={(methods as PaymentMethod[]) || []}
      bankAccounts={(bankAccounts as BankAccount[]) || []}
      permissions={permissions}
    />
  );
}
