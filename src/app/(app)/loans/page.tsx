import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedPaymentMethods } from "@/lib/cached-lookups";
import { LoansClient } from "./loans-client";
import type { Loan, LoanPayment, PaymentMethod } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LoansPage() {
  await requireViewPermission("loans");
  const { permissions } = await getCurrentSession();
  const admin = createServiceClient();
  const tid = currentTenantId();

  let loanQ = admin.from("loans").select("*").order("created_at", { ascending: false });
  let payQ = admin.from("loan_payments").select("*").order("created_at", { ascending: false });
  if (tid) { loanQ = loanQ.eq("tenant_id", tid); payQ = payQ.eq("tenant_id", tid); }

  const [{ data: loans }, { data: payments }, methods, settings] = await Promise.all([
    loanQ, payQ, getCachedPaymentMethods(), getSettings(),
  ]);

  return (
    <LoansClient
      loans={(loans as Loan[]) || []}
      payments={(payments as LoanPayment[]) || []}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
