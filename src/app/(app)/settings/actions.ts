"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import type { SettingsData } from "@/lib/types";

type Result = { ok: boolean; error?: string };

async function readCurrent(): Promise<SettingsData> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("data").eq("id", 1).single();
  return (data?.data as SettingsData) || ({} as SettingsData);
}

async function write(next: SettingsData): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("settings").update({ data: next }).eq("id", 1);
  if (error) return { ok: false, error: error.message };
  // Settings drive layout/header colour etc, revalidate the whole tree.
  revalidatePath("/", "layout");
  // Bust the cross-request unstable_cache so getSettings() returns fresh data
  // immediately instead of waiting for the 60s TTL.
  revalidateTag("app-settings");
  return { ok: true };
}

function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true";
}
function str(fd: FormData, key: string, fallback = ""): string {
  return String(fd.get(key) ?? fallback);
}
function num(fd: FormData, key: string, fallback = 0): number {
  const n = Number(fd.get(key));
  return Number.isFinite(n) ? n : fallback;
}

export async function saveCompany(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    company: {
      name:      str(formData, "name"),
      legalName: str(formData, "legalName"),
      address:   str(formData, "address"),
      phone:     str(formData, "phone"),
      email:     str(formData, "email"),
      taxId:     str(formData, "taxId"),
      website:   str(formData, "website"),
    },
  });
}

export async function saveBranding(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    branding: {
      logoUrl:      str(formData, "logoUrl"),
      primaryColor: str(formData, "primaryColor", "#2563eb"),
      accentColor:  str(formData, "accentColor", "#0ea5e9"),
    },
  });
}

export async function saveLocale(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    locale: {
      country:            str(formData, "country", "KE"),
      language:           str(formData, "language", "en"),
      dateFormat:         str(formData, "dateFormat", "YYYY-MM-DD"),
      timeFormat:         (str(formData, "timeFormat", "24h") as "12h" | "24h"),
      weekStart:          num(formData, "weekStart", 1),
      decimalPlaces:      num(formData, "decimalPlaces", 2),
      thousandsSeparator: str(formData, "thousandsSeparator", ","),
      decimalSeparator:   str(formData, "decimalSeparator", "."),
    },
  });
}

export async function saveCurrencyTax(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    currency: {
      symbol:     str(formData, "symbol", "$"),
      code:       str(formData, "code", "USD"),
      position:   (str(formData, "position", "before") as "before" | "after"),
      rounding:   (str(formData, "rounding", "none") as SettingsData["currency"]["rounding"]),
      hideSymbol: bool(formData, "hideSymbol"),
    },
    tax: {
      defaultRate:    num(formData, "defaultRate", 0),
      name:           str(formData, "taxName", "VAT"),
      inclusive:      bool(formData, "taxInclusive"),
      registrationNo: str(formData, "taxRegistrationNo"),
    },
  });
}

export async function savePos(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  const quickAmounts = str(formData, "quickAmounts", "50,100,200,500,1000,2000")
    .split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return write({
    ...cur,
    pos: {
      quickAmounts,
      requireCustomer:  bool(formData, "requireCustomer"),
      defaultCustomerId: str(formData, "defaultCustomerId") || null,
      autoPrintReceipt: bool(formData, "autoPrintReceipt"),
      scannerEnter:     bool(formData, "scannerEnter"),
      confirmCancel:    bool(formData, "confirmCancel"),
      decimalQty:       bool(formData, "decimalQty"),
    },
  });
}

export async function saveReceipt(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    receipt: {
      paperWidth:       (str(formData, "paperWidth", "80mm") as NonNullable<SettingsData["receipt"]>["paperWidth"]),
      header:           str(formData, "header"),
      footer:           str(formData, "footer"),
      returnPolicy:     str(formData, "returnPolicy"),
      showLogo:         bool(formData, "showLogo"),
      showTaxBreakdown: bool(formData, "showTaxBreakdown"),
    },
  });
}

export async function saveInventory(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  const lowStockThreshold = num(formData, "lowStockThreshold", 5);
  return write({
    ...cur,
    lowStockThreshold,
    inventory: {
      lowStockThreshold,
      allowNegativeStock: bool(formData, "allowNegativeStock"),
      valuationMethod:    (str(formData, "valuationMethod", "average") as NonNullable<SettingsData["inventory"]>["valuationMethod"]),
    },
  });
}

export async function saveSalesDefaults(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    sales: {
      defaultType:       (str(formData, "defaultType", "cash") as "cash" | "credit" | "invoice"),
      defaultCreditDays: num(formData, "defaultCreditDays", 30),
      confirmCancel:     bool(formData, "confirmCancel"),
      allowBackdate:     bool(formData, "allowBackdate"),
      maxBackdateDays:   num(formData, "maxBackdateDays", 7),
    },
  });
}

export async function savePurchasesDefaults(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    purchases: {
      defaultCreditDays: num(formData, "defaultCreditDays", 30),
      confirmCancel:     bool(formData, "confirmCancel"),
      allowBackdate:     bool(formData, "allowBackdate"),
    },
  });
}

export async function saveAccountingDefaults(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  return write({
    ...cur,
    accounting: {
      fiscalYearStartMonth:      num(formData, "fiscalYearStartMonth", 1),
      defaultCashAccountCode:    str(formData, "defaultCashAccountCode", "1010"),
      defaultBankAccountCode:    str(formData, "defaultBankAccountCode", "1100"),
      defaultRevenueAccountCode: str(formData, "defaultRevenueAccountCode", "4000"),
      defaultCogsAccountCode:    str(formData, "defaultCogsAccountCode", "5000"),
    },
  });
}

export async function saveNumbering(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  const next: SettingsData = {
    ...cur,
    numbering: {
      ...cur.numbering,
      invoicePrefix: String(formData.get("invoicePrefix") || "INV-"),
      poPrefix: String(formData.get("poPrefix") || "PO-"),
      customerPrefix: String(formData.get("customerPrefix") || "CUST-"),
      supplierPrefix: String(formData.get("supplierPrefix") || "SUP-"),
      productPrefix: String(formData.get("productPrefix") || "PRD-"),
    } as SettingsData["numbering"],
  };
  return write(next);
}

export async function saveCategories(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  const productCategories = String(formData.get("productCategories") || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return write({ ...cur, productCategories });
}

export async function saveUnits(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  const units = String(formData.get("units") || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return write({ ...cur, units });
}

export async function savePaymentTerms(formData: FormData): Promise<Result> {
  await requirePermission("settings", "edit");
  const cur = await readCurrent();
  const paymentTerms = String(formData.get("paymentTerms") || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return write({ ...cur, paymentTerms });
}
