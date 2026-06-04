"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * App error boundary. Instead of a bare "500 Internal Server Error", show the
 * actual message + digest so a failure is diagnosable (and shareable) on the
 * spot. The digest matches the line logged in the server console.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Also log to the browser console for copy/paste.
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white border rounded-xl p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          This page hit an error while loading. The details below help pinpoint the cause.
        </p>
        <div className="mt-4 rounded-md bg-slate-50 border p-3 text-xs font-mono text-slate-700 break-words whitespace-pre-wrap">
          {error?.message || "Unknown error"}
          {error?.digest && <div className="mt-2 text-slate-400">digest: {error.digest}</div>}
        </div>
        <div className="mt-5 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
