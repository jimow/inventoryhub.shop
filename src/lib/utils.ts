import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SettingsData } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type MoneyFormatOptions = {
  symbol?: string;
  position?: "before" | "after";
  decimalPlaces?: number;
  thousandsSeparator?: string;
  decimalSeparator?: string;
};

/**
 * Process-level locale cache. Filled by SettingsProvider on mount so that
 * existing `formatMoney(x)` / `formatDate(d)` call sites pick up the shop's
 * configured currency + locale without prop-drilling settings everywhere.
 *
 * The cache is per-render on the server (Next.js gives each request a fresh
 * module scope when possible) and per-tab on the client.
 */
const localeCache: Required<MoneyFormatOptions> = {
  symbol: "$",
  position: "before",
  decimalPlaces: 2,
  thousandsSeparator: ",",
  decimalSeparator: ".",
};
let dateCache: DateFormat = "YYYY-MM-DD";
let timeCache: "12h" | "24h" = "24h";

export function setLocaleFromSettings(s: Partial<SettingsData> | undefined): void {
  // When "numbers only" mode is on, clear the symbol so every formatMoney
  // call site naturally drops the prefix/suffix.
  const hide = !!s?.currency?.hideSymbol;
  localeCache.symbol             = hide ? "" : (s?.currency?.symbol ?? "$");
  localeCache.position           = s?.currency?.position ?? "before";
  localeCache.decimalPlaces      = s?.locale?.decimalPlaces ?? 2;
  localeCache.thousandsSeparator = s?.locale?.thousandsSeparator ?? ",";
  localeCache.decimalSeparator   = s?.locale?.decimalSeparator ?? ".";
  dateCache                      = (s?.locale?.dateFormat as DateFormat) || "YYYY-MM-DD";
  timeCache                      = (s?.locale?.timeFormat as "12h" | "24h") || "24h";
}

export function formatMoney(
  n: number | string | null | undefined,
  symbolOrOptions: string | MoneyFormatOptions = localeCache,
) {
  // Back-compat: if a bare string is passed, treat it as a symbol override but
  // keep the rest of the configured locale (decimal places, separators).
  // An EMPTY string is preserved on purpose — that's the "numbers only" mode.
  const opts: MoneyFormatOptions = typeof symbolOrOptions === "string"
    ? { ...localeCache, symbol: symbolOrOptions }
    : { ...localeCache, ...symbolOrOptions };
  const symbol = opts.symbol ?? "$";
  const position = opts.position ?? "before";
  const dp = opts.decimalPlaces ?? 2;
  const thou = opts.thousandsSeparator ?? ",";
  const dec = opts.decimalSeparator ?? ".";

  const v = Number(n ?? 0);
  const buildZero = () => {
    const z = dp > 0 ? `0${dec}${"0".repeat(dp)}` : "0";
    return symbol === ""
      ? z
      : position === "after"
        ? `${z} ${symbol}`
        : `${symbol}${z}`;
  };
  if (!Number.isFinite(v)) return buildZero();

  const fixed = v.toFixed(dp);
  const [whole, frac] = fixed.split(".");
  const wholeWithThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thou);
  const formatted = frac && dp > 0 ? `${wholeWithThousands}${dec}${frac}` : wholeWithThousands;
  if (symbol === "") return formatted;
  return position === "after" ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
}

export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "D MMM YYYY";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatDate(d: string | Date | null | undefined, format: DateFormat = dateCache) {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return String(d);
  const y = x.getFullYear();
  const m = x.getMonth() + 1;
  const day = x.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "DD/MM/YYYY": return `${pad(day)}/${pad(m)}/${y}`;
    case "MM/DD/YYYY": return `${pad(m)}/${pad(day)}/${y}`;
    case "D MMM YYYY": return `${day} ${MONTHS[m - 1]} ${y}`;
    default:           return `${y}-${pad(m)}-${pad(day)}`;
  }
}

/** Time of day per the shop's 12h/24h setting, e.g. "14:05" or "2:05 PM". */
export function formatTime(d: string | Date | null | undefined, mode: "12h" | "24h" = timeCache) {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = x.getHours();
  const min = pad(x.getMinutes());
  if (mode === "12h") {
    const ap = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min} ${ap}`;
  }
  return `${pad(h)}:${min}`;
}

/** Date + time, e.g. "2026-05-29 14:05". Used in transaction lists. */
export function formatDateTime(
  d: string | Date | null | undefined,
  dateFmt: DateFormat = dateCache,
  timeMode: "12h" | "24h" = timeCache,
) {
  if (!d) return "";
  const datePart = formatDate(d, dateFmt);
  const timePart = formatTime(d, timeMode);
  return timePart ? `${datePart} ${timePart}` : datePart;
}

/** Build a date formatter pre-bound to the shop's locale settings. */
export function dateFormatter(settings: Partial<SettingsData> | undefined) {
  const fmt = (settings?.locale?.dateFormat as DateFormat | undefined) || "YYYY-MM-DD";
  return (d: string | Date | null | undefined) => formatDate(d, fmt);
}

/** Generate the next document number and bump the counter inside settings.data */
export function nextDocNumber(
  settings: SettingsData,
  field: keyof SettingsData["numbering"],
  prefix: string
): { number: string; updated: SettingsData } {
  const current = Number((settings.numbering as unknown as Record<string, number>)[field] ?? 1);
  const number = `${prefix}${String(current).padStart(5, "0")}`;
  const updated: SettingsData = {
    ...settings,
    numbering: {
      ...settings.numbering,
      [field]: current + 1,
    } as SettingsData["numbering"],
  };
  return { number, updated };
}

/**
 * Returns the currency symbol to display, honoring the "numbers only"
 * (hideSymbol) toggle. Use this instead of reading `settings.currency.symbol`
 * directly whenever you pass an explicit symbol to formatMoney.
 */
export function currencySymbol(settings: Partial<SettingsData> | undefined): string {
  if (settings?.currency?.hideSymbol) return "";
  return settings?.currency?.symbol || "$";
}

export type LineTotals = { subtotal: number; tax: number; total: number };

/**
 * Compute money totals for a list of line items, honoring tax-inclusive mode.
 *
 * Exclusive (default — tax added on top):
 *   subtotal = Σ qty × price
 *   base     = subtotal − discount
 *   tax      = base × rate
 *   total    = base + tax
 *
 * Inclusive (line prices already include tax — Settings → Currency & Tax):
 *   subtotal = Σ qty × price                 (gross, as entered by the user)
 *   gross    = subtotal − discount           (this IS the total)
 *   net      = gross / (1 + rate/100)
 *   tax      = gross − net                   (the portion of the gross that's tax)
 *   total    = gross                         (what the customer actually pays)
 *
 * Use the same helper on both the editor (so the displayed total matches what
 * gets saved) and the server action (so the saved total matches the journal).
 */
export function computeLineTotals(
  lines: { qty: number | string; price: number | string }[],
  discount: number = 0,
  taxRate: number = 0,
  inclusive: boolean = false,
): LineTotals {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0);
  const disc = Math.max(0, Number(discount) || 0);
  const gross = Math.max(0, subtotal - disc);
  const rate = Number(taxRate) || 0;
  if (inclusive) {
    const net = rate > 0 ? gross / (1 + rate / 100) : gross;
    return { subtotal: r2(subtotal), tax: r2(gross - net), total: r2(gross) };
  }
  const tax = (gross * rate) / 100;
  return { subtotal: r2(subtotal), tax: r2(tax), total: r2(gross + tax) };
}

/** Build a money formatter pre-bound to the shop's locale + currency settings. */
export function moneyFormatter(settings: Partial<SettingsData> | undefined) {
  const hide = !!settings?.currency?.hideSymbol;
  const opts: MoneyFormatOptions = {
    symbol: hide ? "" : (settings?.currency?.symbol ?? "$"),
    position: settings?.currency?.position ?? "before",
    decimalPlaces: settings?.locale?.decimalPlaces ?? 2,
    thousandsSeparator: settings?.locale?.thousandsSeparator ?? ",",
    decimalSeparator: settings?.locale?.decimalSeparator ?? ".",
  };
  return (n: number | string | null | undefined) => formatMoney(n, opts);
}

export const STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "info" | "secondary"> = {
  active: "success",
  inactive: "secondary",
  draft: "secondary",
  confirmed: "info",
  ordered: "info",
  received: "success",
  paid: "success",
  cancelled: "danger",
};
