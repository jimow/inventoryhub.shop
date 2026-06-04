import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getLedgerSnapshot } from "@/lib/ledger";
import { getCachedPaymentMethods } from "@/lib/cached-lookups";
import { EquityClient } from "./equity-client";
import type { Shareholder, EquityContribution, PaymentMethod } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EquityPage() {
  await requireViewPermission("equity");
  const { permissions } = await getCurrentSession();
  const admin = createServiceClient();
  const tid = currentTenantId();

  let shQ = admin.from("shareholders").select("*").order("name");
  let coQ = admin.from("equity_contributions").select("*").order("created_at", { ascending: false });
  if (tid) { shQ = shQ.eq("tenant_id", tid); coQ = coQ.eq("tenant_id", tid); }

  const [{ data: shareholders }, { data: contributions }, methods, settings, ledger] = await Promise.all([
    shQ, coQ, getCachedPaymentMethods(), getSettings(), getLedgerSnapshot(),
  ]);

  return (
    <EquityClient
      shareholders={(shareholders as Shareholder[]) || []}
      contributions={(contributions as EquityContribution[]) || []}
      methods={methods as PaymentMethod[]}
      settings={settings}
      contributedEquity={ledger.ownerEquity}
      retainedEarnings={ledger.netProfit}
      equityTotal={ledger.totalEquity}
      permissions={permissions}
    />
  );
}
