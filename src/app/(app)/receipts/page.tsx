import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { getCachedCustomersList, getCachedPaymentMethods } from "@/lib/cached-lookups";
import { parseListParams, listRange, type ListSearchParams } from "@/lib/list-params";
import { ReceiptsClient } from "./receipts-client";
import type { Payment, Sale, Customer, PaymentMethod } from "@/lib/types";

export default async function ReceiptsPage({
  searchParams,
}: { searchParams: Promise<ListSearchParams> }) {
  // Receipts are a view of inward sale-payments — reuses the payments permission.
  await requireViewPermission("payments");
  const { permissions } = await getCurrentSession();
  const sp = await searchParams;
  const params = parseListParams(sp, ["payment_method_id", "customer_id", "from", "to"]);
  const { from, to } = listRange(params);
  const supabase = await createClient();

  // Every money-in payment shows up here, whether it's tied to a sale,
  // a customer deposit (source_type='other' + customer_id), or other income.
  let query = supabase
    .from("payments")
    .select("*", { count: "exact" })
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.q) query = query.or(`payment_no.ilike.%${params.q}%,reference.ilike.%${params.q}%`);
  if (params.filters.payment_method_id) query = query.eq("payment_method_id", params.filters.payment_method_id);
  if (params.filters.customer_id) query = query.eq("customer_id", params.filters.customer_id);
  if (params.filters.from) query = query.gte("date", params.filters.from);
  if (params.filters.to) query = query.lte("date", params.filters.to);

  const [{ data: payments, count }, { data: sales }, { data: openSales }, customers, methods, { data: accounts }, settings] = await Promise.all([
    query,
    supabase.from("sales").select("id, invoice_no, total, items, sale_type, tax, discount, subtotal"),
    supabase.from("sales").select("id, invoice_no, date, due_date, total, amount_paid, customer_id, sale_type")
      .eq("status", "confirmed").neq("sale_type", "cash").order("date", { ascending: false }),
    getCachedCustomersList(),
    getCachedPaymentMethods(),
    supabase.from("accounts").select("code, name, type").eq("is_active", true).eq("type", "income").order("code"),
    getSettings(),
  ]);

  return (
    <ReceiptsClient
      payments={(payments as Payment[]) || []}
      totalCount={count || 0}
      sales={(sales as Sale[]) || []}
      openSales={openSales || []}
      customers={customers as Customer[]}
      methods={methods as PaymentMethod[]}
      incomeAccounts={accounts || []}
      settings={settings}
      permissions={permissions}
    />
  );
}
