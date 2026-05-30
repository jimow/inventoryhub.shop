"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, AlertTriangle, Loader2, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { csvToObjects, downloadCsv, toCsv } from "@/lib/csv";

const MAX_PREVIEW = 5;

export function ImportDialog({
  open,
  onClose,
  title,
  templateHeaders,
  /** Server action that bulk-inserts rows. Must return ok + counts. */
  action,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  templateHeaders: string[];
  action: (rows: Record<string, string>[]) => Promise<{
    ok: boolean;
    inserted?: number;
    failed?: number;
    error?: string;
  }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setRows([]);
    setFilename(null);
    setError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFilename(f.name);
    setError(null);
    try {
      const text = await f.text();
      const parsed = csvToObjects(text);
      if (parsed.length === 0) {
        setError("No data rows found");
        setRows([]);
        return;
      }
      // Validate required headers exist (case-insensitive)
      const have = new Set(Object.keys(parsed[0] || {}).map((h) => h.toLowerCase()));
      const required = templateHeaders.filter((h) => !h.startsWith("(")).map((h) => h.toLowerCase());
      const missing = required.filter((h) => !have.has(h));
      if (missing.length) {
        setError(`Missing required column(s): ${missing.join(", ")}`);
        setRows([]);
        return;
      }
      setRows(parsed);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function downloadTemplate() {
    downloadCsv("template.csv", toCsv([templateHeaders, []]));
  }

  function commit() {
    if (!rows.length) return;
    start(async () => {
      const r = await action(rows);
      if (!r.ok) {
        toast.error(r.error || "Import failed");
        return;
      }
      const msg = `${r.inserted ?? 0} imported${r.failed ? `, ${r.failed} skipped` : ""}`;
      toast.success(msg);
      reset();
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Upload a CSV file. The first row must be the column headers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border-2 border-dashed border-slate-200 p-6 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block mx-auto text-sm"
            />
            {filename && <p className="mt-2 text-xs text-muted-foreground">{filename}</p>}
          </div>

          <div className="flex items-center justify-between text-sm">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download CSV template
            </Button>
            {rows.length > 0 && (
              <span className="text-muted-foreground">
                {rows.length} row{rows.length === 1 ? "" : "s"} ready to import
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {rows.length > 0 && (
            <div className="border rounded-md overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {Object.keys(rows[0]).map((k) => (
                      <th key={k} className="text-left p-2 font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, MAX_PREVIEW).map((r, i) => (
                    <tr key={i} className="border-t">
                      {Object.keys(rows[0]).map((k) => (
                        <td key={k} className="p-2 truncate max-w-[160px]">{r[k]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > MAX_PREVIEW && (
                <div className="text-xs text-muted-foreground p-2 border-t bg-slate-50">
                  …and {rows.length - MAX_PREVIEW} more rows
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => (reset(), onClose())}>Cancel</Button>
          <Button onClick={commit} disabled={!rows.length || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import {rows.length ? `${rows.length} rows` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
