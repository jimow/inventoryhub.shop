"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Save, Building2, DollarSign, Hash, Tags, Ruler, Wallet,
  Palette, Globe, ScanLine, Printer, Boxes, Receipt as ReceiptIcon, ShoppingCart, BookOpen,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

import type { SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import {
  saveCompany, saveBranding, saveLocale, saveCurrencyTax,
  savePos, saveReceipt, saveInventory, saveSalesDefaults,
  savePurchasesDefaults, saveAccountingDefaults,
  saveNumbering, saveCategories, saveUnits, savePaymentTerms,
} from "./actions";

const TABS = [
  { id: "company",    label: "Company",        icon: Building2 },
  { id: "branding",   label: "Branding",       icon: Palette },
  { id: "locale",     label: "Locale",         icon: Globe },
  { id: "currency",   label: "Currency & Tax", icon: DollarSign },
  { id: "pos",        label: "POS",            icon: ScanLine },
  { id: "receipt",    label: "Receipt",        icon: Printer },
  { id: "inventory",  label: "Inventory",      icon: Boxes },
  { id: "sales",      label: "Sales defaults", icon: ReceiptIcon },
  { id: "purchases",  label: "Purchase defaults", icon: ShoppingCart },
  { id: "accounting", label: "Accounting",     icon: BookOpen },
  { id: "numbering",  label: "Numbering",      icon: Hash },
  { id: "categories", label: "Categories",     icon: Tags },
  { id: "units",      label: "Units",          icon: Ruler },
  { id: "payment",    label: "Payment Terms",  icon: Wallet },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SettingsClient({
  settings, permissions,
}: { settings: SettingsData; permissions: PermissionMatrix }) {
  const [tab, setTab] = useState<TabId>("company");
  const editable = can(permissions, "settings", "edit");

  return (
    <div>
      <PageHeader title="Settings" description="Company, currency, document numbering, and reference data" />
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 md:col-span-3 p-2">
          <ul className="space-y-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    tab === id ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-slate-50"
                  }`}
                  onClick={() => setTab(id)}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="col-span-12 md:col-span-9 p-6">
          {tab === "company"    && <CompanyTab data={settings} editable={editable} />}
          {tab === "branding"   && <BrandingTab data={settings} editable={editable} />}
          {tab === "locale"     && <LocaleTab data={settings} editable={editable} />}
          {tab === "currency"   && <CurrencyTab data={settings} editable={editable} />}
          {tab === "pos"        && <PosTab data={settings} editable={editable} />}
          {tab === "receipt"    && <ReceiptTab data={settings} editable={editable} />}
          {tab === "inventory"  && <InventoryTab data={settings} editable={editable} />}
          {tab === "sales"      && <SalesDefaultsTab data={settings} editable={editable} />}
          {tab === "purchases"  && <PurchasesDefaultsTab data={settings} editable={editable} />}
          {tab === "accounting" && <AccountingDefaultsTab data={settings} editable={editable} />}
          {tab === "numbering"  && <NumberingTab data={settings} editable={editable} />}
          {tab === "categories" && <CategoriesTab data={settings} editable={editable} />}
          {tab === "units"      && <UnitsTab data={settings} editable={editable} />}
          {tab === "payment"    && <PaymentTab data={settings} editable={editable} />}
        </Card>
      </div>
    </div>
  );
}

function useFormSubmit(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await action(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success("Saved");
      router.refresh();
    });
  }
  return { onSubmit, pending };
}

function SaveBar({ pending, editable }: { pending: boolean; editable: boolean }) {
  if (!editable) return null;
  return (
    <div className="mt-5">
      <Button type="submit" disabled={pending}>
        <Save className="h-4 w-4" /> {pending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

function CompanyTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveCompany);
  const c = data.company || ({} as SettingsData["company"]);
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Company Information</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 md:col-span-1">
          <Label htmlFor="name">Trading Name</Label>
          <Input id="name" name="name" defaultValue={c.name} disabled={!editable} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <Label htmlFor="legalName">Legal Name</Label>
          <Input id="legalName" name="legalName" defaultValue={c.legalName} disabled={!editable} />
        </div>
        <div className="col-span-2"><Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={c.address} disabled={!editable} />
        </div>
        <div className="col-span-2 md:col-span-1"><Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={c.phone} disabled={!editable} />
        </div>
        <div className="col-span-2 md:col-span-1"><Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={c.email} disabled={!editable} />
        </div>
        <div className="col-span-2 md:col-span-1"><Label htmlFor="website">Website</Label>
          <Input id="website" name="website" defaultValue={c.website} disabled={!editable} placeholder="https://example.com" />
        </div>
        <div className="col-span-2 md:col-span-1">
          <Label htmlFor="taxId">Tax ID</Label>
          <Input id="taxId" name="taxId" defaultValue={c.taxId} disabled={!editable} />
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function BrandingTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveBranding);
  const b = data.branding || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Branding</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label htmlFor="logoUrl">Logo URL</Label>
          <Input id="logoUrl" name="logoUrl" defaultValue={b.logoUrl} disabled={!editable}
            placeholder="https://your-cdn.com/logo.png" />
          <p className="text-xs text-muted-foreground mt-1">Shown on receipts and the topbar.</p>
        </div>
        <div><Label htmlFor="primaryColor">Primary Colour</Label>
          <Input id="primaryColor" name="primaryColor" type="color" defaultValue={b.primaryColor || "#2563eb"} disabled={!editable} />
        </div>
        <div><Label htmlFor="accentColor">Accent Colour</Label>
          <Input id="accentColor" name="accentColor" type="color" defaultValue={b.accentColor || "#0ea5e9"} disabled={!editable} />
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function LocaleTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveLocale);
  const l = data.locale || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Locale &amp; Formatting</h2>
      <div className="grid grid-cols-3 gap-3">
        <div><Label htmlFor="country">Country</Label>
          <Input id="country" name="country" defaultValue={l.country || "KE"} disabled={!editable} placeholder="KE" />
        </div>
        <div><Label htmlFor="language">Language</Label>
          <Select id="language" name="language" defaultValue={l.language || "en"} disabled={!editable}>
            <option value="en">English</option>
            <option value="sw">Swahili</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
          </Select>
        </div>
        <div><Label htmlFor="weekStart">Week Starts</Label>
          <Select id="weekStart" name="weekStart" defaultValue={String(l.weekStart ?? 1)} disabled={!editable}>
            <option value="0">Sunday</option>
            <option value="1">Monday</option>
          </Select>
        </div>
        <div><Label htmlFor="dateFormat">Date Format</Label>
          <Select id="dateFormat" name="dateFormat" defaultValue={l.dateFormat || "YYYY-MM-DD"} disabled={!editable}>
            <option value="YYYY-MM-DD">2026-05-27 (ISO)</option>
            <option value="DD/MM/YYYY">27/05/2026</option>
            <option value="MM/DD/YYYY">05/27/2026</option>
            <option value="D MMM YYYY">27 May 2026</option>
          </Select>
        </div>
        <div><Label htmlFor="timeFormat">Time Format</Label>
          <Select id="timeFormat" name="timeFormat" defaultValue={l.timeFormat || "24h"} disabled={!editable}>
            <option value="24h">24-hour</option>
            <option value="12h">12-hour</option>
          </Select>
        </div>
        <div><Label htmlFor="decimalPlaces">Decimal Places</Label>
          <Select id="decimalPlaces" name="decimalPlaces" defaultValue={String(l.decimalPlaces ?? 2)} disabled={!editable}>
            <option value="0">0 (KES style)</option>
            <option value="2">2 (USD style)</option>
            <option value="3">3</option>
          </Select>
        </div>
        <div><Label htmlFor="thousandsSeparator">Thousands Separator</Label>
          <Input id="thousandsSeparator" name="thousandsSeparator" defaultValue={l.thousandsSeparator ?? ","} disabled={!editable} maxLength={1} />
        </div>
        <div><Label htmlFor="decimalSeparator">Decimal Separator</Label>
          <Input id="decimalSeparator" name="decimalSeparator" defaultValue={l.decimalSeparator ?? "."} disabled={!editable} maxLength={1} />
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function CurrencyTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveCurrencyTax);
  const cur = data.currency || ({} as SettingsData["currency"]);
  const tax = data.tax || ({} as SettingsData["tax"]);
  const [hideSymbol, setHideSymbol] = useState<boolean>(!!cur.hideSymbol);
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Currency &amp; Tax</h2>

      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            id="hideSymbol"
            name="hideSymbol"
            className="mt-0.5"
            defaultChecked={!!cur.hideSymbol}
            onChange={(e) => setHideSymbol(e.target.checked)}
            disabled={!editable}
          />
          <span className="text-sm">
            <span className="font-medium">Numbers only (no currency symbol)</span>
            <span className="block text-xs text-muted-foreground">
              Show plain numbers everywhere (e.g. <code>1,000.00</code> instead of <code>KSh 1,000.00</code>). Use this if you don&apos;t want a currency displayed.
            </span>
          </span>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div><Label htmlFor="symbol">Currency Symbol</Label>
          <Input id="symbol" name="symbol" defaultValue={cur.symbol} disabled={!editable || hideSymbol} placeholder="KSh" />
        </div>
        <div><Label htmlFor="code">Currency Code</Label>
          <Input id="code" name="code" defaultValue={cur.code} disabled={!editable} placeholder="KES" />
        </div>
        <div><Label htmlFor="position">Symbol Position</Label>
          <Select id="position" name="position" defaultValue={cur.position || "before"} disabled={!editable || hideSymbol}>
            <option value="before">Before (KSh 1,000)</option>
            <option value="after">After (1,000 KSh)</option>
          </Select>
        </div>
        <div><Label htmlFor="rounding">Cash Rounding</Label>
          <Select id="rounding" name="rounding" defaultValue={cur.rounding || "none"} disabled={!editable}>
            <option value="none">None</option>
            <option value="0.05">Nearest 0.05</option>
            <option value="0.1">Nearest 0.10</option>
            <option value="1">Nearest 1</option>
            <option value="5">Nearest 5</option>
            <option value="10">Nearest 10</option>
          </Select>
        </div>

        <div><Label htmlFor="taxName">Tax Name</Label>
          <Input id="taxName" name="taxName" defaultValue={tax.name || "VAT"} disabled={!editable} placeholder="VAT / GST" />
        </div>
        <div><Label htmlFor="defaultRate">Default Rate (%)</Label>
          <Input id="defaultRate" name="defaultRate" type="number" step="0.01" min="0"
            defaultValue={Number(tax.defaultRate || 0)} disabled={!editable} />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" id="taxInclusive" name="taxInclusive" defaultChecked={!!tax.inclusive} disabled={!editable} />
          <Label htmlFor="taxInclusive">Prices are tax-inclusive</Label>
        </div>
        <div className="col-span-3"><Label htmlFor="taxRegistrationNo">Tax Registration No. (shown on receipt)</Label>
          <Input id="taxRegistrationNo" name="taxRegistrationNo" defaultValue={tax.registrationNo} disabled={!editable} />
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function PosTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(savePos);
  const p = data.pos || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">POS behaviour</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label htmlFor="quickAmounts">Cash Quick Amounts</Label>
          <Input id="quickAmounts" name="quickAmounts"
            defaultValue={(p.quickAmounts || [50,100,200,500,1000,2000]).join(",")}
            disabled={!editable} />
          <p className="text-xs text-muted-foreground mt-1">Comma-separated values shown as quick-tender chips in the POS pay dialog.</p>
        </div>
        <Toggle name="requireCustomer"  label="Require customer on every sale"     defaultChecked={!!p.requireCustomer}  editable={editable} />
        <Toggle name="autoPrintReceipt" label="Auto-print receipt after sale"      defaultChecked={!!p.autoPrintReceipt} editable={editable} />
        <Toggle name="scannerEnter"     label="Enter key on search auto-adds match" defaultChecked={p.scannerEnter !== false} editable={editable} />
        <Toggle name="confirmCancel"    label="Confirm before cancelling a sale"   defaultChecked={p.confirmCancel !== false} editable={editable} />
        <Toggle name="decimalQty"       label="Allow decimal quantities (kg, l)"    defaultChecked={!!p.decimalQty} editable={editable} />
        <div className="col-span-2"><Label htmlFor="defaultCustomerId">Default Walk-in Customer ID</Label>
          <Input id="defaultCustomerId" name="defaultCustomerId"
            defaultValue={p.defaultCustomerId || ""} disabled={!editable} placeholder="(leave blank for none)" />
          <p className="text-xs text-muted-foreground mt-1">Optional. If set, every POS sale uses this customer unless changed at the till.</p>
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function ReceiptTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveReceipt);
  const r = data.receipt || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Receipt Template</h2>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="paperWidth">Paper Width</Label>
          <Select id="paperWidth" name="paperWidth" defaultValue={r.paperWidth || "80mm"} disabled={!editable}>
            <option value="58mm">58 mm (thermal)</option>
            <option value="80mm">80 mm (thermal)</option>
            <option value="A5">A5</option>
          </Select>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" id="showLogo" name="showLogo" defaultChecked={r.showLogo !== false} disabled={!editable} />
          <Label htmlFor="showLogo">Show logo on receipt</Label>
        </div>
        <div className="col-span-2"><Label htmlFor="header">Receipt Header</Label>
          <Textarea id="header" name="header" rows={3} defaultValue={r.header} disabled={!editable}
            placeholder="Sales tax slip / Welcome / Free WiFi …" />
        </div>
        <div className="col-span-2"><Label htmlFor="footer">Receipt Footer</Label>
          <Textarea id="footer" name="footer" rows={3} defaultValue={r.footer || "Thank you for your business!"} disabled={!editable} />
        </div>
        <div className="col-span-2"><Label htmlFor="returnPolicy">Return Policy</Label>
          <Textarea id="returnPolicy" name="returnPolicy" rows={2} defaultValue={r.returnPolicy} disabled={!editable}
            placeholder="Returns accepted within 7 days with receipt." />
        </div>
        <Toggle name="showTaxBreakdown" label="Show tax breakdown on receipt" defaultChecked={r.showTaxBreakdown !== false} editable={editable} />
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function InventoryTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveInventory);
  const inv = data.inventory || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Inventory</h2>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="lowStockThreshold">Low-Stock Threshold</Label>
          <Input id="lowStockThreshold" name="lowStockThreshold" type="number" step="1" min="0"
            defaultValue={Number(inv.lowStockThreshold ?? data.lowStockThreshold ?? 5)} disabled={!editable} />
        </div>
        <div><Label htmlFor="valuationMethod">Stock Valuation</Label>
          <Select id="valuationMethod" name="valuationMethod" defaultValue={inv.valuationMethod || "average"} disabled={!editable}>
            <option value="average">Weighted average</option>
            <option value="fifo">FIFO (first in, first out)</option>
            <option value="lifo">LIFO (last in, first out)</option>
          </Select>
        </div>
        <Toggle name="allowNegativeStock" label="Allow selling below current stock (negative stock)" defaultChecked={!!inv.allowNegativeStock} editable={editable} />
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function SalesDefaultsTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveSalesDefaults);
  const s = data.sales || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Sales Defaults</h2>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="defaultType">Default Sale Type</Label>
          <Select id="defaultType" name="defaultType" defaultValue={s.defaultType || "cash"} disabled={!editable}>
            <option value="cash">Cash</option>
            <option value="credit">Credit</option>
            <option value="invoice">Invoice</option>
          </Select>
        </div>
        <div><Label htmlFor="defaultCreditDays">Default Credit Days</Label>
          <Input id="defaultCreditDays" name="defaultCreditDays" type="number" min="0"
            defaultValue={Number(s.defaultCreditDays ?? 30)} disabled={!editable} />
        </div>
        <Toggle name="confirmCancel" label="Confirm before cancelling a sale" defaultChecked={s.confirmCancel !== false} editable={editable} />
        <Toggle name="allowBackdate" label="Allow back-dating sales"          defaultChecked={!!s.allowBackdate} editable={editable} />
        <div><Label htmlFor="maxBackdateDays">Max back-date days</Label>
          <Input id="maxBackdateDays" name="maxBackdateDays" type="number" min="0"
            defaultValue={Number(s.maxBackdateDays ?? 7)} disabled={!editable} />
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function PurchasesDefaultsTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(savePurchasesDefaults);
  const p = data.purchases || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Purchase Defaults</h2>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="defaultCreditDays">Default Credit Days</Label>
          <Input id="defaultCreditDays" name="defaultCreditDays" type="number" min="0"
            defaultValue={Number(p.defaultCreditDays ?? 30)} disabled={!editable} />
        </div>
        <Toggle name="confirmCancel" label="Confirm before cancelling a PO"     defaultChecked={p.confirmCancel !== false} editable={editable} />
        <Toggle name="allowBackdate" label="Allow back-dating purchases" defaultChecked={p.allowBackdate !== false} editable={editable} />
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function AccountingDefaultsTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveAccountingDefaults);
  const a = data.accounting || {};
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Accounting Defaults</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Use the chart-of-accounts <i>code</i> (e.g. 1010 Cash Drawer, 1100 Bank, 4000 Sales Revenue, 5000 COGS).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="fiscalYearStartMonth">Fiscal Year Starts</Label>
          <Select id="fiscalYearStartMonth" name="fiscalYearStartMonth"
            defaultValue={String(a.fiscalYearStartMonth ?? 1)} disabled={!editable}>
            {["January","February","March","April","May","June","July","August","September","October","November","December"]
              .map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="defaultCashAccountCode">Default Cash Account</Label>
          <Input id="defaultCashAccountCode" name="defaultCashAccountCode" defaultValue={a.defaultCashAccountCode || "1010"} disabled={!editable} />
        </div>
        <div><Label htmlFor="defaultBankAccountCode">Default Bank Account</Label>
          <Input id="defaultBankAccountCode" name="defaultBankAccountCode" defaultValue={a.defaultBankAccountCode || "1100"} disabled={!editable} />
        </div>
        <div><Label htmlFor="defaultRevenueAccountCode">Default Revenue Account</Label>
          <Input id="defaultRevenueAccountCode" name="defaultRevenueAccountCode" defaultValue={a.defaultRevenueAccountCode || "4000"} disabled={!editable} />
        </div>
        <div><Label htmlFor="defaultCogsAccountCode">Default COGS Account</Label>
          <Input id="defaultCogsAccountCode" name="defaultCogsAccountCode" defaultValue={a.defaultCogsAccountCode || "5000"} disabled={!editable} />
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function Toggle({ name, label, defaultChecked, editable }: { name: string; label: string; defaultChecked: boolean; editable: boolean }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={!editable} />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function NumberingTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveNumbering);
  const n = data.numbering || ({} as SettingsData["numbering"]);
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Document Numbering</h2>
      <p className="text-xs text-muted-foreground mb-3">Prefix used when generating new document numbers. Counters increment automatically.</p>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["invoicePrefix",  "Invoice Prefix"],
          ["poPrefix",       "PO Prefix"],
          ["customerPrefix", "Customer Prefix"],
          ["supplierPrefix", "Supplier Prefix"],
          ["productPrefix",  "Product Prefix"],
        ].map(([key, label]) => (
          <div key={key}>
            <Label htmlFor={key}>{label}</Label>
            <Input id={key} name={key} defaultValue={(n as unknown as Record<string, string>)[key] ?? ""} disabled={!editable} />
          </div>
        ))}
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function CategoriesTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveCategories);
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Categories</h2>
      <div className="grid grid-cols-1 gap-3">
        <div>
          <Label htmlFor="productCategories">Product Categories</Label>
          <Textarea id="productCategories" name="productCategories" rows={6} disabled={!editable}
            defaultValue={(data.productCategories || []).join("\n")} />
          <p className="text-xs text-muted-foreground mt-1">One per line</p>
        </div>
      </div>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function UnitsTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(saveUnits);
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Units of Measure</h2>
      <Textarea name="units" rows={8} disabled={!editable} defaultValue={(data.units || []).join("\n")} />
      <p className="text-xs text-muted-foreground mt-1">One per line (e.g. pcs, kg, l, box)</p>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}

function PaymentTab({ data, editable }: { data: SettingsData; editable: boolean }) {
  const { onSubmit, pending } = useFormSubmit(savePaymentTerms);
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold mb-3">Payment Terms</h2>
      <Textarea name="paymentTerms" rows={8} disabled={!editable} defaultValue={(data.paymentTerms || []).join("\n")} />
      <p className="text-xs text-muted-foreground mt-1">One per line (e.g. Net 30)</p>
      <SaveBar pending={pending} editable={editable} />
    </form>
  );
}
