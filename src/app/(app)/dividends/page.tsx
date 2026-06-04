import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedPaymentMethods } from "@/lib/cached-lookups";
import { DividendsClient } from "./dividends-client";
import type { Shareholder, DividendDeclaration, DividendLine, DividendPayout, PaymentMethod } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  await requireViewPermission("equity");
  const { permissions } = await getCurrentSession();
  const admin = createServiceClient();
  const tid = currentTenantId();
  let shQ = admin.from("shareholders").select("id, name, ownership_pct, status").order("name");
  let declQ = admin.from("dividend_declarations").select("*").order("created_at", { ascending: false });
  let lineQ = admin.from("dividend_lines").select("*");
  let payQ = admin.from("dividend_payouts").select("*");
  if (tid) {
    shQ = shQ.eq("tenant_id", tid); declQ = declQ.eq("tenant_id", tid);
    lineQ = lineQ.eq("tenant_id", tid); payQ = payQ.eq("tenant_id", tid);
  }

  const [{ data: shareholders }, { data: declarations }, { data: lines }, { data: payouts }, methods, settings] = await Promise.all([
    shQ, declQ, lineQ, payQ, getCachedPaymentMethods(), getSettings(),
  ]);

  return (
    <DividendsClient
      shareholders={(shareholders as Shareholder[]) || []}
      declarations={(declarations as DividendDeclaration[]) || []}
      lines={(lines as DividendLine[]) || []}
      payouts={(payouts as DividendPayout[]) || []}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
