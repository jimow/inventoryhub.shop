"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  ScrollText,
  ShieldCheck,
  LogOut,
  ServerCog,
  Server,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { platformLogout } from "@/app/platform/login/actions";

const NAV = [
  { href: "/platform",        label: "Overview",       icon: LayoutDashboard, exact: true },
  { href: "/platform/tenants", label: "Tenants",        icon: Building2 },
  { href: "/platform/servers", label: "Servers",        icon: Server },
  { href: "/platform/tests",   label: "System Tests",   icon: FlaskConical },
  { href: "/platform/audit",   label: "Audit Log",      icon: ScrollText },
  { href: "/platform/admins",  label: "Platform Admins", icon: ShieldCheck },
];

export function PlatformShell({
  children, admin,
}: {
  children: React.ReactNode;
  admin: { name: string | null; email: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();

  function signOut() {
    start(async () => {
      await platformLogout();
      router.push("/platform/login");
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-60 bg-gradient-to-b from-slate-900 via-slate-900 to-[#0b1220] border-r border-slate-950/50 z-30">
        <div className="h-16 flex items-center gap-3 px-5 border-b border-white/10">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg ring-1 ring-white/15">
            <ServerCog className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-white">Platform Console</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Super Admin</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                  active
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium shadow-lg shadow-blue-950/40"
                    : "text-slate-300 hover:bg-white/[0.07] hover:text-white"
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.25 : 2} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-white/10">
          <div className="px-2 mb-2">
            <p className="text-xs font-medium text-slate-200 truncate">{admin.name || "Administrator"}</p>
            <p className="text-[11px] text-slate-500 truncate">{admin.email}</p>
          </div>
          <button
            onClick={signOut}
            disabled={pending}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.07] hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" /> {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 bg-slate-900 text-white flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <ServerCog className="h-5 w-5" />
          <span className="font-semibold text-sm">Platform Console</span>
        </div>
        <button onClick={signOut} disabled={pending} className="text-slate-300 hover:text-white">
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      <main className="md:ml-60">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
