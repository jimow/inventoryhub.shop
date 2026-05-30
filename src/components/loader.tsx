import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable loading indicators.
 *
 * <Loader />                          — small inline spinner
 * <Loader size="lg" />                — larger spinner
 * <Loader label="Saving..." />        — spinner + label
 * <Loader fullScreen label="..." />   — fullscreen overlay
 */
export function Loader({
  size = "md", label, fullScreen, className,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  fullScreen?: boolean;
  className?: string;
}) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-5 w-5";

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/70 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
          {label && <div className="text-sm text-slate-700">{label}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-2 text-slate-600", className)}>
      <Loader2 className={cn(sizeClass, "animate-spin text-blue-600")} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Centred page-level skeleton — used by default loading.tsx files. */
export function PageLoader({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-72 bg-slate-200 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="h-4 w-20 bg-slate-200 rounded mb-2" />
            <div className="h-6 w-32 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 border-t first:border-t-0">
            <div className="h-4 w-24 bg-slate-200 rounded" />
            <div className="h-4 w-40 bg-slate-200 rounded flex-1" />
            <div className="h-4 w-16 bg-slate-200 rounded" />
            <div className="h-4 w-20 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
