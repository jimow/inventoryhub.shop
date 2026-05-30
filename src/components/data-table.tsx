"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronDown,
  X, Loader2, Inbox, Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PAGE_SIZE_OPTIONS } from "@/lib/list-params";

export type Column<T> = {
  key: string;
  label: string;
  className?: string;
  render?: (row: T) => React.ReactNode;
};

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

export type BulkAction<T> = {
  label: string;
  icon?: React.ElementType;
  variant?: "default" | "destructive" | "outline";
  run: (rows: T[]) => Promise<{ ok: boolean; error?: string; message?: string }>;
};

export type DataTableProps<T extends { id: string }> = {
  columns: Column<T>[];
  data: T[];
  totalCount: number;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  toolbar?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  bulkActions?: BulkAction<T>[];
  isPending?: boolean;
  /**
   * If provided, each row gets a chevron toggle on the left. Clicking the
   * chevron (or the row body, if `rowClickExpands` is true) shows the
   * `render` output in an inline "drawer" row beneath the main row.
   */
  expandable?: {
    render: (row: T) => React.ReactNode;
    /** When true, clicking anywhere on the row toggles expansion. Defaults to false. */
    rowClickExpands?: boolean;
    /** When true, only one row can be open at a time. */
    singleOpen?: boolean;
  };
};

const DEBOUNCE_MS = 350;

export function DataTable<T extends { id: string }>({
  columns,
  data,
  totalCount,
  searchPlaceholder = "Search...",
  filters = [],
  toolbar,
  rowActions,
  bulkActions = [],
  isPending,
  expandable,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const q = sp.get("q") || "";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const pageSize = parseInt(sp.get("pageSize") || "25", 10) || 25;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const [search, setSearch] = React.useState(q);
  const [transition, startTransition] = React.useTransition();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (expandable?.singleOpen) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  // Whenever the data changes (filter / pagination), drop expansion state
  // so we don't leave dangling open drawers pointing at rows that vanished.
  React.useEffect(() => {
    setExpanded(new Set());
  }, [data]);

  React.useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => updateParams({ q: search || null, page: 1 }), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  React.useEffect(() => {
    setSelected(new Set());
  }, [data]);

  const allSelected = data.length > 0 && data.every((r) => selected.has(r.id));
  const someSelected = data.some((r) => selected.has(r.id));

  function toggleAll() {
    if (allSelected) {
      const next = new Set(selected);
      data.forEach((r) => next.delete(r.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      data.forEach((r) => next.add(r.id));
      setSelected(next);
    }
  }

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function updateParams(patch: Record<string, string | number | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === undefined) next.delete(k);
      else next.set(k, String(v));
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  function clearFilters() {
    setSearch("");
    startTransition(() => router.push(pathname));
  }

  const hasActiveFilters = !!q || filters.some((f) => sp.get(f.key));
  const selectedRows = React.useMemo(
    () => data.filter((r) => selected.has(r.id)), [data, selected]
  );
  const showLoading = transition || isPending;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {filters.map((f) => (
            <Select
              key={f.key}
              value={sp.get(f.key) || ""}
              onChange={(e) => updateParams({ [f.key]: e.target.value || null, page: 1 })}
              className="w-auto min-w-[140px]"
            >
              <option value="">{f.label}: All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{f.label}: {o.label}</option>
              ))}
            </Select>
          ))}

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Reset
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {showLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {toolbar}
          </div>
        </div>

        {selected.size > 0 && bulkActions.length > 0 && (
          <div className="flex items-center gap-2 p-2 px-3 bg-blue-50 border-b border-blue-100 text-sm">
            <span className="font-medium text-blue-900">{selected.size} selected</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <div className="ml-auto flex items-center gap-2">
              {bulkActions.map((a, i) => {
                const Icon = a.icon;
                return (
                  <Button
                    key={i}
                    size="sm"
                    variant={a.variant || "outline"}
                    disabled={bulkPending}
                    onClick={async () => {
                      setBulkPending(true);
                      try {
                        const r = await a.run(selectedRows);
                        const sonner = await import("sonner");
                        if (!r.ok) sonner.toast.error(r.error || "Action failed");
                        else {
                          sonner.toast.success(r.message || "Done");
                          setSelected(new Set());
                          startTransition(() => router.refresh());
                        }
                      } finally {
                        setBulkPending(false);
                      }
                    }}
                  >
                    {bulkPending ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
                    {a.label}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="relative">
          <Table>
            <TableHeader>
              <TableRow>
                {expandable && <TableHead className="w-[32px]" />}
                {bulkActions.length > 0 && (
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                {columns.map((c) => (
                  <TableHead key={c.key} className={c.className}>{c.label}</TableHead>
                ))}
                {rowActions && <TableHead className="text-right w-[160px]">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                // Total column count for colSpan in skeletons / empty / drawer rows
                const colCount =
                  (expandable ? 1 : 0) +
                  (bulkActions.length > 0 ? 1 : 0) +
                  columns.length +
                  (rowActions ? 1 : 0);

                if (showLoading && data.length === 0) {
                  return Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skel-${i}`}>
                      {expandable && <TableCell />}
                      {bulkActions.length > 0 && <TableCell><Skeleton className="h-4 w-4" /></TableCell>}
                      {columns.map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[160px]" /></TableCell>
                      ))}
                      {rowActions && <TableCell><Skeleton className="h-7 w-24 ml-auto" /></TableCell>}
                    </TableRow>
                  ));
                }
                if (data.length === 0) {
                  return (
                    <TableRow>
                      <TableCell colSpan={colCount}>
                        <div className="flex flex-col items-center text-muted-foreground py-12">
                          <Inbox className="h-10 w-10 opacity-40 mb-2" />
                          <span className="text-sm">No records match your filters</span>
                          {hasActiveFilters && (
                            <Button variant="link" size="sm" onClick={clearFilters}>Reset filters</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }
                return data.map((row) => {
                  const isSelected = selected.has(row.id);
                  const isOpen = expanded.has(row.id);
                  const rowClickable = !!expandable?.rowClickExpands;
                  return (
                    <React.Fragment key={row.id}>
                      <TableRow
                        className={cn(
                          isSelected && "bg-blue-50/50",
                          isOpen && "bg-slate-50",
                          rowClickable && "cursor-pointer",
                        )}
                        onClick={rowClickable ? () => toggleExpanded(row.id) : undefined}
                      >
                        {expandable && (
                          <TableCell className="w-[32px] p-0">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleExpanded(row.id); }}
                              className="h-9 w-9 flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                              aria-label={isOpen ? "Collapse row" : "Expand row"}
                              aria-expanded={isOpen}
                            >
                              <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                            </button>
                          </TableCell>
                        )}
                        {bulkActions.length > 0 && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onChange={() => toggleRow(row.id)}
                              aria-label="Select row"
                            />
                          </TableCell>
                        )}
                        {columns.map((c) => (
                          <TableCell key={c.key} className={c.className}>
                            {c.render ? c.render(row) : ((row as unknown as Record<string, unknown>)[c.key] as React.ReactNode)}
                          </TableCell>
                        ))}
                        {rowActions && (
                          <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex gap-1">{rowActions(row)}</div>
                          </TableCell>
                        )}
                      </TableRow>
                      {expandable && isOpen && (
                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                          <TableCell colSpan={colCount} className="p-0 border-t-0">
                            <div className="border-l-4 border-blue-500 bg-white px-5 py-4">
                              {expandable.render(row)}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                });
              })()}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t text-sm">
          <div className="text-muted-foreground">
            {totalCount === 0
              ? "0 records"
              : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} of ${totalCount}`}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Select
                value={String(pageSize)}
                onChange={(e) => updateParams({ pageSize: e.target.value, page: 1 })}
                className="w-20 h-8"
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" disabled={page === 1} onClick={() => updateParams({ page: 1 })}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" disabled={page === 1} onClick={() => updateParams({ page: page - 1 })}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs px-2 min-w-[80px] text-center">Page {page} / {totalPages}</span>
              <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => updateParams({ page: page + 1 })}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => updateParams({ page: totalPages })}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
