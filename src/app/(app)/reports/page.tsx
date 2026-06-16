import { createServiceClient, currentTenantId } from "@/lib/supabase/server";
import { requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { ReportsClient } from "./reports-client";
import type { Account, JournalLine, JournalEntry } from "@/lib/types";
import type { ReportSale, ReportPurchase, ReportPayment, ReportProduct, NameRef } from "./reports-client";

export default async function ReportsPage() {
  await requireViewPermission("accounting");
  const admin = createServiceClient();
  // Service role bypasses RLS — scope every read to this tenant.
  const tid = currentTenantId();
  let accountsQ = admin.from("accounts").select("*").order("code");
  let linesQ = admin.from("journal_lines").select("*");
  let entriesQ = admin.from("journal_entries").select("id, date, entry_no, description, source_type");
  let banksQ = admin.from("bank_accounts").select("opening_balance, account_id");
  // Operational data for the general (sales/purchases/stock/payments/receipts) reports.
  let salesQ = admin.from("sales").select("id, invoice_no, date, customer_id, subtotal, discount, tax, total, status, sale_type").order("date", { ascending: false });
  let purchasesQ = admin.from("purchases").select("id, po_no, date, supplier_id, subtotal, discount, tax, total, status").order("date", { ascending: false });
  let paymentsQ = admin.from("payments").select("id, payment_no, date, direction, source_type, amount, customer_id, supplier_id, payment_method_id, reference").order("date", { ascending: false });
  let productsQ = admin.from("products").select("id, name, code, category, cost_price, selling_price, current_stock, min_stock, status");
  let customersQ = admin.from("customers").select("id, name");
  let suppliersQ = admin.from("suppliers").select("id, name");
  let methodsQ = admin.from("payment_methods").select("id, name");
  if (tid) {
    accountsQ = accountsQ.eq("tenant_id", tid);
    linesQ = linesQ.eq("tenant_id", tid);
    entriesQ = entriesQ.eq("tenant_id", tid);
    banksQ = banksQ.eq("tenant_id", tid);
    salesQ = salesQ.eq("tenant_id", tid);
    purchasesQ = purchasesQ.eq("tenant_id", tid);
    paymentsQ = paymentsQ.eq("tenant_id", tid);
    productsQ = productsQ.eq("tenant_id", tid);
    customersQ = customersQ.eq("tenant_id", tid);
    suppliersQ = suppliersQ.eq("tenant_id", tid);
    methodsQ = methodsQ.eq("tenant_id", tid);
  }
  const [
    { data: accounts }, { data: lines }, { data: entries }, { data: banks }, settings,
    { data: sales }, { data: purchases }, { data: payments }, { data: products },
    { data: customers }, { data: suppliers }, { data: methods },
  ] = await Promise.all([
    accountsQ, linesQ, entriesQ, banksQ, getSettings(),
    salesQ, purchasesQ, paymentsQ, productsQ, customersQ, suppliersQ, methodsQ,
  ]);
  // Bank opening balances live outside the journal — pass them through so the
  // Balance Sheet includes them (and stays consistent with the cash figure the
  // payment screens / Dashboard show).
  const bankOpenings = (banks || [])
    .filter((b) => b.account_id && Number(b.opening_balance || 0) !== 0)
    .map((b) => ({ account_id: b.account_id as string, opening_balance: Number(b.opening_balance || 0) }));
  return (
    <ReportsClient
      accounts={(accounts as Account[]) || []}
      lines={(lines as JournalLine[]) || []}
      entries={(entries as JournalEntry[]) || []}
      bankOpenings={bankOpenings}
      settings={settings}
      sales={(sales as ReportSale[]) || []}
      purchases={(purchases as ReportPurchase[]) || []}
      payments={(payments as ReportPayment[]) || []}
      products={(products as ReportProduct[]) || []}
      customers={(customers as NameRef[]) || []}
      suppliers={(suppliers as NameRef[]) || []}
      methods={(methods as NameRef[]) || []}
    />
  );
}
