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
  Coins,
  Undo2,
  History,
} from "lucide-react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Module, PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import type { SettingsData } from "@/lib/types";
import { useMobileNav } from "@/components/mobile-nav";

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
  { href: "/returns",           label: "Returns",           module: "returns",    icon: Undo2,           section: "Transactions" },

  { href: "/employees",         label: "Employees",         module: "employees",  icon: Briefcase,       section: "Workforce" },
  { href: "/payroll",           label: "Payroll",           module: "payroll",    icon: Banknote,        section: "Workforce" },

  { href: "/bank-accounts",     label: "Bank Accounts",     module: "accounting", icon: Landmark,        section: "Accounting" },
  { href: "/payment-methods",   label: "Payment Methods",   module: "accounting", icon: CreditCard,      section: "Accounting" },
  { href: "/chart-of-accounts", label: "Chart of Accounts", module: "accounting", icon: BookOpen,        section: "Accounting" },
  { href: "/journal",           label: "Journal",           module: "accounting", icon: BookOpenCheck,   section: "Accounting" },
  { href: "/equity",            label: "Equity & Owners",   module: "equity",     icon: UsersIcon,       section: "Accounting" },
  { href: "/loans",             label: "Loans",             module: "loans",      icon: Wallet,          section: "Accounting" },
  { href: "/dividends",         label: "Dividends",         module: "equity",     icon: Coins,           section: "Accounting" },
  { href: "/reports",           label: "Reports",           module: "accounting", icon: BarChart3,       section: "Accounting" },

  { href: "/activity-log",      label: "Activity Log",      module: "audit",      icon: History,         section: "Administration" },
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
  const { open, setOpen } = useMobileNav();
  const visible = NAV.filter((n) => can(permissions, n.module, "view"));
  const sections = SECTION_ORDER.filter((s) => visible.some((n) => n.section === s));

  const companyName = settings?.company?.name || "Inventory MS";
  const tagline = settings?.company?.legalName || "Management";
  const logoUrl = settings?.branding?.logoUrl;

  const inner = (
    <>
      {/* Brand */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-white/10">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl} alt={companyName}
            className="h-9 w-9 rounded-xl object-cover shadow-lg ring-1 ring-white/15"
          />
        ) : (
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-900/40 ring-1 ring-white/15">
            <Boxes className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
        )}
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-sm font-semibold text-white truncate" title={companyName}>
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
            <div className="px-3 mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {sec}
              </span>
              <span className="flex-1 h-px bg-white/10" />
            </div>
            <div className="space-y-1">
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
                      onClick={() => setOpen(false)}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg pl-3 pr-3 py-2 text-sm transition-all duration-150",
                        active
                          ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium shadow-lg shadow-blue-950/40"
                          : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform",
                          active ? "text-white" : "text-slate-400 group-hover:text-white group-hover:scale-110"
                        )}
                        strokeWidth={active ? 2.25 : 2}
                      />
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/90 shadow" />}
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/10">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="font-medium text-slate-400">v1.0</span>
          <span>Inventory System</span>
        </div>
      </div>
    </>
  );

  const surface = "bg-gradient-to-b from-slate-900 via-slate-900 to-[#0b1220] border-r border-slate-950/50";

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside className={cn("hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-64 z-30 overflow-y-auto", surface)}>
        {inner}
      </aside>

      {/* Mobile: slide-in drawer + backdrop */}
      <div
        className={cn(
          "md:hidden fixed inset-0 z-50 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!open}
      >
        <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-72 max-w-[85%] flex flex-col overflow-y-auto shadow-2xl transition-transform duration-200",
            surface,
            open ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <button
            onClick={() => setOpen(false)}
            className="absolute top-4 right-3 z-10 h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
          {inner}
        </aside>
      </div>
    </>
  );
}
