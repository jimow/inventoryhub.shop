import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/numbering";
import { getCachedPaymentMethods } from "@/lib/cached-lookups";
import { PayrollClient } from "./payroll-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Employee, PaymentMethod, SalaryPayment, PayrollRun } from "@/lib/types";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const { permissions } = await getCurrentSession();
  // Viewable by the dedicated payroll permission, or anyone who could already
  // see the workforce module (back-compat so payroll isn't suddenly hidden).
  if (!can(permissions, "payroll", "view") && !can(permissions, "employees", "view")) {
    redirect("/forbidden?module=payroll&action=view");
  }
  const sp = await searchParams;
  const params = parseListParams(sp, ["status", "employee_id"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  let query = supabase
    .from("salary_payments").select("*", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (params.q) query = query.ilike("payment_no", `%${params.q}%`);
  if (params.filters.status) query = query.eq("status", params.filters.status);
  if (params.filters.employee_id) query = query.eq("employee_id", params.filters.employee_id);

  const [{ data: payments, count }, { data: employees }, { data: runs }, methods, settings] = await Promise.all([
    query,
    supabase.from("employees").select("*").order("full_name"),
    supabase.from("payroll_runs").select("*").order("period_end", { ascending: false }),
    getCachedPaymentMethods(),
    getSettings(),
  ]);

  return (
    <PayrollClient
      payments={(payments as SalaryPayment[]) || []}
      totalCount={count || 0}
      employees={(employees as Employee[]) || []}
      runs={(runs as PayrollRun[]) || []}
      methods={methods as PaymentMethod[]}
      settings={settings}
      permissions={permissions}
    />
  );
}
