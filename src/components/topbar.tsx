"use client";

import { LogOut, Menu } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { MODULE_LABELS, type Module } from "@/lib/permissions";
import { useMobileNav } from "@/components/mobile-nav";

export function Topbar({ user }: { user: { name: string; role: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setOpen } = useMobileNav();
  const segment = (pathname.split("/").filter(Boolean)[0] || "dashboard") as Module;
  const title = MODULE_LABELS[segment] || "Dashboard";
  const initials = (user.name || "U")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function onLogout() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="fixed top-0 right-0 left-0 md:left-64 h-14 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/65 border-b border-slate-200/80 shadow-[0_1px_2px_rgba(16,24,40,0.03)] z-20 flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={() => setOpen(true)}
          className="md:hidden h-9 w-9 -ml-1 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold text-slate-900 tracking-tight truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 px-1 py-1 pr-3 rounded-full hover:bg-slate-50 transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-blue-500 text-white flex items-center justify-center text-[11px] font-semibold shadow-sm">
            {initials}
          </div>
          <div className="text-xs leading-tight">
            <div className="font-semibold text-slate-900">{user.name}</div>
            <div className="text-slate-500">{user.role}</div>
          </div>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={onLogout}
          title="Sign out"
          className="border-slate-200 text-slate-500 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
