"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { SettingsData } from "@/lib/types";
import {
  formatMoney, formatDate, setLocaleFromSettings,
  type MoneyFormatOptions, type DateFormat,
} from "@/lib/utils";

const Ctx = createContext<SettingsData | null>(null);

export function SettingsProvider({
  value, children,
}: { value: SettingsData; children: ReactNode }) {
  // Push settings into the module-level locale cache so EVERY bare
  // formatMoney(x) / formatDate(d) call in the tree picks up the right
  // symbol, decimal places, separators, and date format -- no prop-drilling.
  useMemo(() => setLocaleFromSettings(value), [value]);
  useEffect(() => { setLocaleFromSettings(value); }, [value]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read the live settings document. Returns an empty SettingsData if used
 * outside a SettingsProvider (so the hook never throws and code degrades to
 * default formatting).
 */
export function useSettings(): SettingsData {
  return useContext(Ctx) ?? ({} as SettingsData);
}

/**
 * Returns a money formatter pre-bound to the shop's currency + locale.
 *
 *   const money = useMoney();
 *   money(1234.5)  ->  "KSh 1,234.50"   or  "1 234,50 KSh", etc.
 */
export function useMoney() {
  const s = useSettings();
  // Honor the "numbers only" toggle from Settings → Currency & Tax.
  const hide = !!s.currency?.hideSymbol;
  const opts: MoneyFormatOptions = {
    symbol:             hide ? "" : (s.currency?.symbol ?? "$"),
    position:           s.currency?.position ?? "before",
    decimalPlaces:      s.locale?.decimalPlaces ?? 2,
    thousandsSeparator: s.locale?.thousandsSeparator ?? ",",
    decimalSeparator:   s.locale?.decimalSeparator ?? ".",
  };
  return (n: number | string | null | undefined) => formatMoney(n, opts);
}

/**
 * Returns a date formatter pre-bound to the shop's locale.dateFormat.
 *
 *   const fmtDate = useFmtDate();
 *   fmtDate("2026-05-27")  ->  "27/05/2026" depending on settings
 */
export function useFmtDate() {
  const s = useSettings();
  const fmt = (s.locale?.dateFormat as DateFormat | undefined) || "YYYY-MM-DD";
  return (d: string | Date | null | undefined) => formatDate(d, fmt);
}
