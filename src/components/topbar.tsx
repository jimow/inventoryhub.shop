"use client";

import { LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { MODULE_LABELS, type Module } from "@/lib/permissions";

export function Topbar({ user }: { user: { name: string; role: string } }) {
  const router = useRouter();
  const pathname = usePathname();
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
    <div className="fixed top-0 right-0 left-0 md:left-60 h-14 bg-white border-b border-slate-200 z-20 flex items-center justify-between px-6">
      <h1 className="text-base font-semibold text-slate-900 tracking-tight">{title}</h1>
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
