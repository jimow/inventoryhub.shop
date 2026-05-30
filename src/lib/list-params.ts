// Helpers for parsing list-page URL search params (filters / pagination / sort).

export type ListSearchParams = Record<string, string | string[] | undefined>;

export type ListParams = {
  q: string;
  page: number;
  pageSize: number;
  sort: string | null;
  dir: "asc" | "desc";
  filters: Record<string, string>;
};

const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export function parseListParams(
  sp: ListSearchParams,
  filterKeys: string[] = []
): ListParams {
  const get = (k: string) => {
    const v = sp[k];
    if (Array.isArray(v)) return v[0] ?? "";
    return v ?? "";
  };

  const page = Math.max(1, parseInt(get("page") || "1", 10) || 1);
  const pageSizeRaw = parseInt(get("pageSize") || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE;

  const filters: Record<string, string> = {};
  for (const k of filterKeys) {
    const v = get(k);
    if (v) filters[k] = v;
  }

  return {
    q: get("q"),
    page,
    pageSize,
    sort: get("sort") || null,
    dir: (get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
    filters,
  };
}

export function listRange(p: ListParams): { from: number; to: number } {
  const from = (p.page - 1) * p.pageSize;
  const to = from + p.pageSize - 1;
  return { from, to };
}

export function buildHref(
  base: string,
  current: ListSearchParams,
  patch: Record<string, string | number | undefined | null>
) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) usp.set(k, value);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") usp.delete(k);
    else usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `${base}?${s}` : base;
}

export const PAGE_SIZE_OPTIONS = PAGE_SIZES;
