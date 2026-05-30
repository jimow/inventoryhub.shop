import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getCachedCustomersList, getCachedSuppliersList, getCachedPaymentMethods, getCachedActiveAccounts } from "@/lib/cached-lookups";
import { PaymentsClient } from "./payments-client";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import type { Payment, PaymentMethod, Customer, Supplier } from "@/lib/types";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  await requireViewPermission("payments");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["source_type", "payment_method_id"]);
  const { from, to } = listRange(params);

  const supabase = await createClient();
  // Payments = money OUT only (purchases, expenses, salaries). Money received
  // lives on the Receipts page (direction='in').
  let query = supabase.from("payments").select("*", { count: "exact" })
    .eq("direction", "out")
    .order("created_at", { ascending: false }).range(from, to);

  if (params.q) query = query.or(`payment_no.ilike.%${params.q}%,reference.ilike.%${params.q}%`);
  if (params.filters.source_type) query = query.eq("source_type", params.filters.source_type);
  if (params.filters.payment_method_id) query = query.eq("payment_method_id", params.filters.payment_method_id);

  const [{ data: payments, count }, { data: purchases }, methods, customers, suppliers, accounts] = await Promise.all([
    query,
    supabase.from("purchases").select("id, po_no, date, due_date, total, amount_paid, supplier_id").eq("status", "received"),
    getCachedPaymentMethods(),
    getCachedCustomersList(),
    getCachedSuppliersList(),
    getCachedActiveAccounts(),
  ]);

  return (
    <PaymentsClient
      payments={(payments as Payment[]) || []}
      totalCount={count || 0}
      methods={methods as PaymentMethod[]}
      customers={customers as Customer[]}
      suppliers={suppliers as Supplier[]}
      openPurchases={purchases || []}
      accounts={accounts}
      permissions={permissions}
    />
  );
}
