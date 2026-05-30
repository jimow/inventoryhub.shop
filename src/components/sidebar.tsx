"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  LayoutDashboard,
  Package,
  Users as UsersIcon,
  Truck,
  Receipt,
  ShoppingCart,
  UserCog,
  ShieldCheck,
  Settings as SettingsIcon,
  ScanLine,
  Wallet,
  CreditCard,
  Landmark,
  BookOpen,
  BookOpenCheck,
  BarChart3,
  Briefcase,
  Banknote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Module, PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import type { SettingsData } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  module: Module;
  icon: React.ElementType;
  section: string;
};

const NAV: NavItem[] = [
  { href: "/dashboard",         label: "Dashboard",         module: "dashboard",  icon: LayoutDashboard, section: "Overview" },
  { href: "/pos",               label: "Point of Sale",     module: "pos",        icon: ScanLine,        section: "Overview" },

  { href: "/products",          label: "Products",          module: "products",   icon: Package,         section: "Inventory" },

  { href: "/customers",         label: "Customers",         module: "customers",  icon: UsersIcon,       section: "Contacts" },
  { href: "/suppliers",         label: "Suppliers",         module: "suppliers",  icon: Truck,           section: "Contacts" },

  { href: "/sales",             label: "Sales",             module: "sales",      icon: Receipt,         section: "Transactions" },
  { href: "/purchases",         label: "Purchases",         module: "purchases",  icon: ShoppingCart,    section: "Transactions" },
  { href: "/payments",          label: "Payments",          module: "payments",   icon: Wallet,          section: "Transactions" },
  { href: "/receipts",          label: "Receipts",          module: "payments",   icon: Receipt,         section: "Transactions" },

  { href: "/employees",         label: "Employees",         module: "employees",  icon: Briefcase,       section: "Workforce" },
  { href: "/payroll",           label: "Payroll",           module: "payroll",    icon: Banknote,        section: "Workforce" },

  { href: "/bank-accounts",     label: "Bank Accounts",     module: "accounting", icon: Landmark,        section: "Accounting" },
  { href: "/payment-methods",   label: "Payment Methods",   module: "accounting", icon: CreditCard,      section: "Accounting" },
  { href: "/chart-of-accounts", label: "Chart of Accounts", module: "accounting", icon: BookOpen,        section: "Accounting" },
  { href: "/journal",           label: "Journal",           module: "accounting", icon: BookOpenCheck,   section: "Accounting" },
  { href: "/reports",           label: "Reports",           module: "accounting", icon: BarChart3,       section: "Accounting" },

  { href: "/users",             label: "Users",             module: "users",      icon: UserCog,         section: "Administration" },
  { href: "/roles",             label: "Roles & Permissions", module: "roles",    icon: ShieldCheck,     section: "Administration" },
  { href: "/settings",          label: "Settings",          module: "settings",   icon: SettingsIcon,    section: "Administration" },
];

const SECTION_ORDER = [
  "Overview",
  "Inventory",
  "Contacts",
  "Transactions",
  "Workforce",
  "Accounting",
  "Administration",
];

export function Sidebar({
  permissions, settings,
}: {
  permissions: PermissionMatrix;
  settings?: SettingsData;
}) {
  const pathname = usePathname();
  const visible = NAV.filter((n) => can(permissions, n.module, "view"));
  const sections = SECTION_ORDER.filter((s) => visible.some((n) => n.section === s));

  const companyName = settings?.company?.name || "Inventory MS";
  const tagline = settings?.company?.legalName || "Management";
  const logoUrl = settings?.branding?.logoUrl;

  return (
    <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-60 bg-gradient-to-b from-white to-slate-50/40 border-r border-slate-200 z-30 overflow-y-auto">
      {/* Brand */}
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-slate-200 bg-white">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl} alt={companyName}
            className="h-8 w-8 rounded-lg object-cover shadow-sm border border-slate-200"
          />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-blue-600 flex items-center justify-center shadow-sm ring-1 ring-blue-700/20">
            <Boxes className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
        )}
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-sm font-semibold text-slate-900 truncate" title={companyName}>
            {companyName}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 truncate" title={tagline}>
            {tagline}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-5">
        {sections.map((sec) => (
          <div key={sec}>
            <div className="px-3 mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {sec}
              </span>
              <span className="flex-1 h-px bg-slate-200/70" />
            </div>
            <div className="space-y-0.5">
              {visible
                .filter((n) => n.section === sec)
                .map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-md pl-3 pr-3 py-2 text-sm transition-all",
                        active
                          ? "bg-blue-50 text-blue-700 font-medium shadow-sm"
                          : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900"
                      )}
                    >
                      {/* Left accent bar on active item */}
                      <span
                        className={cn(
                          "absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full transition-all",
                          active ? "bg-blue-600" : "bg-transparent group-hover:bg-slate-300"
                        )}
                      />
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-transform",
                          active
                            ? "text-blue-600"
                            : "text-slate-400 group-hover:text-slate-600 group-hover:scale-110"
                        )}
                        strokeWidth={active ? 2.25 : 2}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-200 bg-white/50">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>v1.0</span>
          <span>· Inventory System</span>
        </div>
      </div>
    </aside>
  );
}
