"use client";

import { useState, useTransition } from "react";
import { Loader2, Store, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { installTenant } from "./actions";

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
  return base ? `shop_${base}` : "";
}

export function InstallClient() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [company, setCompany] = useState("");
  const [schema, setSchema] = useState("");
  const [schemaTouched, setSchemaTouched] = useState(false);

  function onCompany(v: string) {
    setCompany(v);
    if (!schemaTouched) setSchema(slugify(v));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("schema", schema);
    start(async () => {
      const r = await installTenant(fd);
      if (!r.ok) { setError(r.error || "Install failed"); toast.error(r.error || "Install failed"); return; }
      setNotice(r.notice || null);
      setDone(true);
      toast.success("Shop installed");
      // Hard navigation (not router.push) so the server fully re-evaluates
      // install state and the /install route is left behind for good.
      if (!r.notice) setTimeout(() => { window.location.href = "/login"; }, 1200);
    });
  }

  if (done) {
    return (
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <h1 className="mt-3 text-xl font-semibold text-slate-900">Shop installed</h1>
        {notice ? (
          <>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
            </div>
            <Button className="mt-4" onClick={() => { window.location.href = "/login"; }}>I&apos;ve done that — continue to sign in</Button>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            Schema <b>{schema}</b> is ready. Redirecting you to sign in…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-xl">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-slate-900 p-2.5"><Store className="h-5 w-5 text-white" /></div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Set up your shop</h1>
          <p className="text-sm text-slate-500">Creates this shop&apos;s isolated database schema and your admin login.</p>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-5 space-y-5">
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shop</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="company_name">Company / shop name *</Label>
              <Input id="company_name" name="company_name" value={company}
                onChange={(e) => onCompany(e.target.value)} placeholder="Mombasa Hardware" required />
            </div>
            <div className="col-span-2">
              <Label htmlFor="schema">Schema (database namespace) *</Label>
              <Input id="schema" name="schema" value={schema} required
                onChange={(e) => { setSchemaTouched(true); setSchema(e.target.value.toLowerCase()); }}
                pattern="[a-z][a-z0-9_]{1,40}" placeholder="shop_mombasa" className="font-mono" />
              <p className="mt-1 text-xs text-slate-500">lower_snake_case. This permanently isolates the shop&apos;s data.</p>
            </div>
            <div>
              <Label htmlFor="company_phone">Phone</Label>
              <Input id="company_phone" name="company_phone" placeholder="+254 700 000 000" />
            </div>
            <div>
              <Label htmlFor="company_email">Business email</Label>
              <Input id="company_email" name="company_email" type="email" placeholder="info@shop.com" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="company_address">Address</Label>
              <Input id="company_address" name="company_address" placeholder="Street, City" />
            </div>
            <div>
              <Label htmlFor="company_tax_id">Tax ID</Label>
              <Input id="company_tax_id" name="company_tax_id" placeholder="Optional" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Currency &amp; tax</h2>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label htmlFor="currency_symbol">Symbol</Label>
              <Input id="currency_symbol" name="currency_symbol" defaultValue="$" />
            </div>
            <div>
              <Label htmlFor="currency_code">Code</Label>
              <Input id="currency_code" name="currency_code" defaultValue="USD" />
            </div>
            <div>
              <Label htmlFor="tax_name">Tax name</Label>
              <Input id="tax_name" name="tax_name" defaultValue="Tax" />
            </div>
            <div>
              <Label htmlFor="tax_rate">Tax %</Label>
              <Input id="tax_rate" name="tax_rate" type="number" step="0.01" min="0" defaultValue="0" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Administrator login</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="admin_name">Full name</Label>
              <Input id="admin_name" name="admin_name" placeholder="Shop Owner" />
            </div>
            <div>
              <Label htmlFor="admin_username">Username</Label>
              <Input id="admin_username" name="admin_username" placeholder="owner" />
            </div>
            <div>
              <Label htmlFor="admin_email">Email *</Label>
              <Input id="admin_email" name="admin_email" type="email" placeholder="owner@shop.com" required />
            </div>
            <div>
              <Label htmlFor="admin_password">Password *</Label>
              <Input id="admin_password" name="admin_password" type="password" minLength={8} placeholder="Min 8 characters" required />
            </div>
          </div>
        </section>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Installing…</span>
          ) : (
            "Install shop"
          )}
        </Button>
      </form>
    </div>
  );
}
