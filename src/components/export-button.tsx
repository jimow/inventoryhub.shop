"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";

/**
 * Export button. Calls a server action that returns CSV text and filename
 * for ALL rows matching the current filters (server resolves them).
 */
export function ExportButton({
  action,
  label = "Export",
}: {
  action: () => Promise<{ ok: boolean; csv?: string; filename?: string; error?: string }>;
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (!r.ok || !r.csv) {
            toast.error(r.error || "Export failed");
            return;
          }
          downloadCsv(r.filename || "export.csv", r.csv);
          toast.success("Export ready");
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
    </Button>
  );
}
