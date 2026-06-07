"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, FlaskConical, Play, ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { runReadinessChecks, runFunctionalTests, runUnitTests, type CheckResult, type CheckStatus } from "./actions";

const ICON: Record<CheckStatus, React.ElementType> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const COLOR: Record<CheckStatus, string> = { pass: "text-emerald-600", warn: "text-amber-600", fail: "text-red-600" };
const BADGE: Record<CheckStatus, "success" | "warning" | "danger"> = { pass: "success", warn: "warning", fail: "danger" };

function summarize(checks: CheckResult[]) {
  const counts = checks.reduce((a, c) => { a[c.status]++; return a; }, { pass: 0, warn: 0, fail: 0 } as Record<CheckStatus, number>);
  return { counts, total: checks.length, ready: checks.length > 0 && counts.fail === 0 };
}

function Summary({ checks, label }: { checks: CheckResult[] | null; label: string }) {
  if (checks === null) return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Running {label}…</div>;
  const { counts, total, ready } = summarize(checks);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="text-base font-semibold text-slate-900">
        {ready ? "✅ All correct" : counts.fail ? "❌ Problems found" : "⚠️ Passed with warnings"}
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-emerald-600 font-medium">{counts.pass} passed</span>
        <span className="text-amber-600 font-medium">{counts.warn} warnings</span>
        <span className="text-red-600 font-medium">{counts.fail} failed</span>
        <span className="text-slate-400">/ {total}</span>
      </div>
    </div>
  );
}

function ResultsGrid({ checks }: { checks: CheckResult[] }) {
  const categories = Array.from(new Set(checks.map((c) => c.category)));
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {categories.map((cat) => (
        <Card key={cat} className="overflow-hidden">
          <div className="px-4 py-2.5 border-b text-sm font-semibold text-slate-800">{cat}</div>
          <div className="divide-y">
            {checks.filter((c) => c.category === cat).map((c, i) => {
              const Icon = ICON[c.status];
              return (
                <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${COLOR[c.status]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-500 break-words">{c.detail}</p>
                  </div>
                  <Badge variant={BADGE[c.status]}>{c.status}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function TestsClient({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [pending, start] = useTransition();

  const [ftTenant, setFtTenant] = useState(tenants[0]?.id || "");
  const [ft, setFt] = useState<CheckResult[] | null>(null);
  const [ftPending, startFt] = useTransition();

  const [unitOut, setUnitOut] = useState<string | null>(null);
  const [unitPending, startUnit] = useTransition();

  function runChecks() { start(async () => setChecks(await runReadinessChecks())); }
  function runFunctional() { setFt(null); startFt(async () => setFt(await runFunctionalTests(ftTenant))); }
  function runUnit() { setUnitOut("Running unit tests…"); startUnit(async () => setUnitOut((await runUnitTests()).output)); }

  useEffect(() => { runChecks(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">System Tests</h1>
        <p className="text-sm text-slate-500">Confirm the system is wired correctly and producing correct results.</p>
      </div>

      {/* Functional correctness — the important one */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-slate-900">Functional correctness audit</h2>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="ft" className="text-xs">Workspace</Label>
              <Select id="ft" value={ftTenant} onChange={(e) => setFtTenant(e.target.value)} className="w-56">
                {tenants.length === 0 && <option value="">No workspaces</option>}
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <Button size="sm" onClick={runFunctional} disabled={ftPending || !ftTenant}>
              {ftPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run audit
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Audits real data: every journal entry balances, trial balance ties out, sales revenue matches invoices, inventory matches purchases,
          and the A/R &amp; A/P control accounts reconcile to the customer/supplier subledgers.
        </p>
        {ft && <Card className={`p-4 border-l-4 ${summarize(ft).ready ? "border-l-emerald-500" : summarize(ft).counts.fail ? "border-l-red-500" : "border-l-amber-500"}`}><Summary checks={ft} label="audit" /></Card>}
        {ftPending && <Card className="p-4"><Summary checks={null} label="audit" /></Card>}
        {ft && <ResultsGrid checks={ft} />}
      </section>

      {/* Production readiness */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Production readiness</h2>
          <Button size="sm" variant="outline" onClick={runChecks} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-run
          </Button>
        </div>
        <Card className={`p-4 border-l-4 ${checks === null ? "border-l-slate-300" : summarize(checks).ready ? "border-l-emerald-500" : summarize(checks).counts.fail ? "border-l-red-500" : "border-l-amber-500"}`}>
          <Summary checks={checks} label="checks" />
        </Card>
        {checks && <ResultsGrid checks={checks} />}
      </section>

      {/* Unit tests */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-slate-600" /><h2 className="text-lg font-semibold text-slate-900">Unit test suite (Vitest)</h2></div>
          <Button size="sm" onClick={runUnit} disabled={unitPending}>
            {unitPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run unit tests
          </Button>
        </div>
        {unitOut === null ? (
          <p className="text-sm text-slate-500">Runs <span className="font-mono">vitest run</span> over the pure-logic suites. Available where dev dependencies are installed.</p>
        ) : (
          <pre className="text-[11px] bg-slate-950 text-slate-100 rounded-lg p-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono">{unitOut}</pre>
        )}
      </section>
    </div>
  );
}
