"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
] as const;

/** Period selector that drives the Sales/Purchases dashboard cards via ?range=. */
export function DashboardRange({ value }: { value: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function pick(id: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("range", id);
    start(() => router.replace(`/dashboard?${params.toString()}`, { scroll: false }));
  }

  return (
    <div className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1", pending && "opacity-60")}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => pick(o.id)}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            value === o.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
