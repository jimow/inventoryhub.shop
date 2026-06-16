"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkIcon } from "lucide-react";

type Related = { href: string; label: string };

// Each page gets a few convenient links to the things people most often jump to
// from it. Keyed by route prefix; the longest matching prefix wins so detail
// routes (e.g. /products/[id]) inherit their section's links.
const MAP: Record<string, Related[]> = {
  "/dashboard": [
    { href: "/reports", label: "Reports" },
    { href: "/pos", label: "Point of Sale" },
    { href: "/sales", label: "Sales" },
  ],
  "/pos": [
    { href: "/sales", label: "Sales" },
    { href: "/products", label: "Products" },
    { href: "/receipts", label: "Receipts" },
  ],
  "/products": [
    { href: "/reports", label: "Stock Report" },
    { href: "/purchases", label: "Purchases" },
    { href: "/sales", label: "Sales" },
  ],
  "/customers": [
    { href: "/sales", label: "Sales" },
    { href: "/quotations", label: "Quotations" },
    { href: "/receipts", label: "Receipts" },
  ],
  "/suppliers": [
    { href: "/purchases", label: "Purchases" },
    { href: "/payments", label: "Payments" },
  ],
  "/quotations": [
    { href: "/sales", label: "Sales" },
    { href: "/customers", label: "Customers" },
    { href: "/products", label: "Products" },
  ],
  "/sales": [
    { href: "/quotations", label: "Quotations" },
    { href: "/reports", label: "Sales Report" },
    { href: "/receipts", label: "Receipts" },
    { href: "/customers", label: "Customers" },
  ],
  "/purchases": [
    { href: "/suppliers", label: "Suppliers" },
    { href: "/reports", label: "Purchases Report" },
    { href: "/payments", label: "Payments" },
    { href: "/returns", label: "Returns" },
  ],
  "/payments": [
    { href: "/reports", label: "Payments Report" },
    { href: "/suppliers", label: "Suppliers" },
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
  ],
  "/receipts": [
    { href: "/reports", label: "Receipts Report" },
    { href: "/customers", label: "Customers" },
    { href: "/sales", label: "Sales" },
  ],
  "/returns": [
    { href: "/sales", label: "Sales" },
    { href: "/purchases", label: "Purchases" },
  ],
  "/employees": [
    { href: "/payroll", label: "Payroll" },
  ],
  "/payroll": [
    { href: "/employees", label: "Employees" },
    { href: "/payments", label: "Payments" },
  ],
  "/bank-accounts": [
    { href: "/payment-methods", label: "Payment Methods" },
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
  ],
  "/payment-methods": [
    { href: "/bank-accounts", label: "Bank Accounts" },
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
  ],
  "/chart-of-accounts": [
    { href: "/journal", label: "Journal" },
    { href: "/reports", label: "Reports" },
  ],
  "/journal": [
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
    { href: "/reports", label: "Reports" },
  ],
  "/equity": [
    { href: "/dividends", label: "Dividends" },
    { href: "/reports", label: "Reports" },
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
  ],
  "/loans": [
    { href: "/payments", label: "Payments" },
    { href: "/reports", label: "Reports" },
  ],
  "/dividends": [
    { href: "/equity", label: "Equity & Owners" },
    { href: "/reports", label: "Reports" },
  ],
  "/reports": [
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
    { href: "/journal", label: "Journal" },
  ],
  "/activity-log": [
    { href: "/reports", label: "Reports" },
  ],
  "/users": [
    { href: "/roles", label: "Roles & Permissions" },
  ],
  "/roles": [
    { href: "/users", label: "Users" },
  ],
  "/settings": [
    { href: "/payment-methods", label: "Payment Methods" },
    { href: "/chart-of-accounts", label: "Chart of Accounts" },
  ],
};

export function RelatedLinks() {
  const pathname = usePathname();
  // Longest matching prefix wins.
  let bestKey = "";
  for (const key of Object.keys(MAP)) {
    if ((pathname === key || pathname.startsWith(key + "/")) && key.length > bestKey.length) {
      bestKey = key;
    }
  }
  const links = bestKey ? MAP[bestKey] : null;
  if (!links || links.length === 0) return null;

  // Don't link a page to itself.
  const shown = links.filter((l) => l.href !== pathname);
  if (shown.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 text-slate-400">
        <LinkIcon className="h-3.5 w-3.5" /> Related:
      </span>
      {shown.map((l) => (
        <Link
          key={l.href + l.label}
          href={l.href}
          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
