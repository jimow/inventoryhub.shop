"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, X, Wallet, Loader2, Banknote, CheckCircle2, AlertCircle, Calendar,
  ClipboardCheck, Users, XCircle, Clock,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";

import type { Employee, PaymentMethod, SalaryPayment, SettingsData, SalaryPaymentStatus, PayrollRun, PayrollRunStatus } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, formatDateTime, currencySymbol } from "@/lib/utils";
import {
  createSalaryPayment, cancelSalaryPayment, createPayrollRun,
  approvePayrollRun, payPayrollRun, cancelPayrollRun,
} from "./actions";

const todayStr = () => new Date().toISOString().slice(0, 10);

/** First open (non-cancelled) run whose window contains [start, end], if any. */
function findCoveringRun(runs: PayrollRun[], start: string, end: string): PayrollRun | null {
  return (
    runs.find(
      (r) => r.status !== "cancelled" && r.period_start <= start && r.period_end >= end
    ) || null
  );
}

const STATUS_OPTIONS = [
  { value: "draft",     label: "Draft" },
  { value: "posted",    label: "Posted" },
  { value: "cancelled", label: "Cancelled" },
];

export function PayrollClient({
  payments, totalCount, employees, runs, methods, settings, permissions,
}: {
  payments: SalaryPayment[];
  totalCount: number;
  employees: Employee[];
  runs: PayrollRun[];
  methods: PaymentMethod[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const sym = currencySymbol(settings);
  const canRun = can(permissions, "payroll", "create");
  const canApprove = can(permissions, "payroll", "approve");
  const canPay = can(permissions, "payroll", "post");
  const canEdit = can(permissions, "payroll", "edit");

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const columns: Column<SalaryPayment>[] = [
    { key: "payment_no", label: "Payment #", className: "w-[140px] font-mono text-xs font-medium" },
    { key: "pay_date", label: "Date & time", className: "w-[150px] text-slate-600 whitespace-nowrap", render: (r) => formatDateTime(r.created_at) },
    {
      key: "employee", label: "Employee",
      render: (r) => {
        const e = empById.get(r.employee_id);
        return e ? (
          <div>
            <div className="font-medium text-slate-900">{e.full_name}</div>
            {e.position && <div className="text-xs text-slate-500">{e.position}</div>}
          </div>
        ) : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: "period", label: "Period", className: "w-[180px] text-xs text-slate-600",
      render: (r) => `${formatDate(r.period_start)} → ${formatDate(r.period_end)}`,
    },
    {
      key: "gross", label: "Gross", className: "w-[120px] text-right tabular-nums",
      render: (r) => formatMoney(r.gross, sym),
    },
    {
      key: "commission", label: "Commission", className: "w-[110px] text-right tabular-nums text-emerald-700",
      render: (r) => Number(r.commission) > 0 ? formatMoney(r.commission, sym) : <span className="text-slate-300">—</span>,
    },
    {
      key: "net", label: "Net Pay", className: "w-[130px] text-right font-semibold tabular-nums text-slate-900",
      render: (r) => formatMoney(r.net, sym),
    },
    {
      key: "status", label: "Status", className: "w-[110px]",
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: STATUS_OPTIONS },
    {
      key: "employee_id", label: "Employee",
      options: employees.map((e) => ({ value: e.id, label: e.full_name })),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Run payroll for a period, approve, then pay · auto-posts double-entry journals"
      >
        {canRun && (
          <Button size="sm" onClick={() => setRunOpen(true)}>
            <Users className="h-4 w-4" /> Run Payroll
          </Button>
        )}
        {canPay && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Single Payment
          </Button>
        )}
      </PageHeader>

      <PayrollRunsPanel
        runs={runs}
        sym={sym}
        canApprove={canApprove}
        canPay={canPay}
        canEdit={canEdit}
      />

      <DataTable<SalaryPayment>
        columns={columns}
        data={payments}
        totalCount={totalCount}
        searchPlaceholder="Search by payment #..."
        filters={filters}
        rowActions={(row) => (
          <RowActions row={row} permissions={permissions} />
        )}
      />

      {addOpen && (
        <SalaryPaymentDialog
          employees={employees}
          runs={runs}
          methods={methods}
          settings={settings}
          onClose={() => setAddOpen(false)}
        />
      )}

      {runOpen && (
        <PayrollRunDialog
          runs={runs}
          employees={employees}
          settings={settings}
          onClose={() => setRunOpen(false)}
        />
      )}
    </div>
  );
}

/* ========================================================================== */
/* PAYROLL RUNS PANEL                                                          */
/* ========================================================================== */
function PayrollRunsPanel({
  runs, sym, canApprove, canPay, canEdit,
}: {
  runs: PayrollRun[];
  sym: string;
  canApprove: boolean;
  canPay: boolean;
  canEdit: boolean;
}) {
  if (!runs.length) return null;
  return (
    <div className="mb-6 rounded-lg border bg-white">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-900">Payroll Runs</h2>
        <span className="text-xs text-slate-500">prepare → approve → pay</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run #</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Pay date</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <RunRow
              key={r.id} run={r} sym={sym}
              canApprove={canApprove} canPay={canPay} canEdit={canEdit}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunRow({
  run, sym, canApprove, canPay, canEdit,
}: {
  run: PayrollRun;
  sym: string;
  canApprove: boolean;
  canPay: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error || "Action failed"); return; }
      toast.success(success);
      router.refresh();
    });
  }

  const showApprove = run.status === "draft" && canApprove;
  const showPay = run.status === "approved" && canPay;
  const showCancel = run.status !== "cancelled" && canEdit;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-medium">{run.run_no}</TableCell>
      <TableCell className="text-xs text-slate-600">
        {formatDate(run.period_start)} → {formatDate(run.period_end)}
      </TableCell>
      <TableCell className="text-xs text-slate-600">{formatDate(run.pay_date)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(run.total_gross, sym)}</TableCell>
      <TableCell className="text-right tabular-nums font-semibold">{formatMoney(run.total_net, sym)}</TableCell>
      <TableCell><RunStatusBadge status={run.status} /></TableCell>
      <TableCell className="text-right">
        <div className="inline-flex gap-1.5 justify-end">
          {pending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          {showApprove && (
            <Button size="sm" variant="outline" disabled={pending}
              onClick={() => act(() => approvePayrollRun(run.id), "Payroll run approved")}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </Button>
          )}
          {showPay && (
            <Button size="sm" disabled={pending}
              onClick={() => {
                if (!confirm(`Pay run ${run.run_no}? This posts journals for every line.`)) return;
                act(() => payPayrollRun(run.id), "Payroll run paid");
              }}>
              <Banknote className="h-3.5 w-3.5" /> Pay
            </Button>
          )}
          {showCancel && (
            <Button size="sm" variant="ghost" disabled={pending} className="text-amber-600"
              onClick={() => {
                const msg = run.status === "posted"
                  ? `Cancel run ${run.run_no}? Reversing journals will be posted for all paid lines.`
                  : `Cancel run ${run.run_no}? Its draft lines will be discarded.`;
                if (!confirm(msg)) return;
                act(() => cancelPayrollRun(run.id), "Payroll run cancelled");
              }}>
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RunStatusBadge({ status }: { status: PayrollRunStatus }) {
  const cfg = {
    draft:     { variant: "secondary" as const, label: "Draft",    icon: Clock },
    approved:  { variant: "warning" as const,   label: "Approved", icon: ClipboardCheck },
    posted:    { variant: "success" as const,   label: "Paid",     icon: CheckCircle2 },
    cancelled: { variant: "danger" as const,    label: "Cancelled", icon: X },
  }[status];
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

/* ========================================================================== */
/* START PAYROLL RUN DIALOG                                                    */
/* ========================================================================== */
function PayrollRunDialog({
  runs, employees, settings, onClose,
}: {
  runs: PayrollRun[];
  employees: Employee[];
  settings: SettingsData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
  const [payDate, setPayDate] = useState(today.toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // Eligible = active employees with a base salary set.
  const eligible = useMemo(
    () => employees.filter((e) => e.status === "active" && Number(e.base_salary) > 0),
    [employees]
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.map((e) => e.id)));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const allSelected = eligible.length > 0 && selected.size === eligible.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(eligible.map((e) => e.id)));
  }

  const selectedTotal = eligible
    .filter((e) => selected.has(e.id))
    .reduce((s, e) => s + (Number(e.base_salary) || 0), 0);

  const inFuture = periodEnd > todayStr();
  const existing = runs.find(
    (r) => r.status !== "cancelled" && r.period_start === periodStart && r.period_end === periodEnd
  );
  const blocked = inFuture || Boolean(existing) || periodEnd < periodStart || selected.size === 0;

  function setLastMonth() {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    setPeriodStart(d.toISOString().slice(0, 10));
    setPeriodEnd(last.toISOString().slice(0, 10));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) { toast.error("Select at least one employee"); return; }
    const fd = new FormData();
    fd.set("period_start", periodStart);
    fd.set("period_end", periodEnd);
    fd.set("pay_date", payDate);
    fd.set("employee_ids", JSON.stringify([...selected]));
    if (notes) fd.set("notes", notes);
    start(async () => {
      const r = await createPayrollRun(fd);
      if (!r.ok) { toast.error(r.error || "Failed to start payroll run"); return; }
      toast.success("Payroll run started — review, approve, then pay");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" /> Run Payroll
          </DialogTitle>
          <DialogDescription>
            Pick a completed period and the employees to include. This stages a draft
            line per employee at their base salary — nothing is paid until you approve
            and pay the run.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="run_period_start">Period Start *</Label>
              <Input id="run_period_start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="run_period_end">Period End *</Label>
              <Input id="run_period_end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="run_pay_date">Pay Date *</Label>
              <Input id="run_pay_date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => { setPeriodStart(firstOfMonth); setPeriodEnd(lastOfMonth); }}>
              <Calendar className="h-3 w-3" /> This month
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={setLastMonth}>Last month</Button>
          </div>

          {/* Employee multi-select */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Employees *</Label>
              <button type="button" onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            {eligible.length === 0 ? (
              <div className="px-3 py-2 bg-slate-50 border rounded-md text-sm text-slate-500">
                No active employees with a base salary.
              </div>
            ) : (
              <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                {eligible.map((e) => (
                  <label key={e.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                    <Checkbox checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{e.full_name}</div>
                      <div className="text-xs text-slate-500">{e.code}{e.position ? ` · ${e.position}` : ""}</div>
                    </div>
                    <div className="text-sm tabular-nums text-slate-700">{formatMoney(e.base_salary, sym)}</div>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-between text-xs text-slate-600">
              <span>{selected.size} selected</span>
              <span>Est. gross: <b className="tabular-nums">{formatMoney(selectedTotal, sym)}</b></span>
            </div>
          </div>

          <div>
            <Label htmlFor="run_notes">Notes</Label>
            <Input id="run_notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>

          {inFuture && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> This period hasn&apos;t ended yet — you can&apos;t start a run for it.
            </div>
          )}
          {existing && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> A run ({existing.run_no}) already exists for this period.
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || blocked}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Create Run ({selected.size})
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: SalaryPaymentStatus }) {
  const cfg = {
    draft:     { variant: "secondary" as const, label: "Draft",     icon: AlertCircle },
    posted:    { variant: "success" as const,   label: "Posted",    icon: CheckCircle2 },
    cancelled: { variant: "danger" as const,    label: "Cancelled", icon: X },
  }[status];
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

function RowActions({
  row, permissions,
}: { row: SalaryPayment; permissions: PermissionMatrix }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function cancel() {
    if (!confirm(`Cancel salary payment ${row.payment_no}? A reversing journal entry will be posted.`)) return;
    start(async () => {
      const r = await cancelSalaryPayment(row.id);
      if (!r.ok) { toast.error(r.error || "Cancel failed"); return; }
      toast.success("Salary payment cancelled and journal reversed");
      router.refresh();
    });
  }
  if (row.status !== "posted" || !can(permissions, "payroll", "edit")) return null;
  return (
    <Button
      variant="ghost" size="icon" disabled={pending}
      onClick={cancel} title="Cancel & reverse"
      className="h-8 w-8 text-amber-600"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
    </Button>
  );
}

/* ========================================================================== */
/* SALARY PAYMENT DIALOG                                                       */
/* ========================================================================== */
function SalaryPaymentDialog({
  employees, runs, methods, settings, onClose,
}: {
  employees: Employee[];
  runs: PayrollRun[];
  methods: PaymentMethod[];
  settings: SettingsData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sym = currencySymbol(settings);

  const activeEmployees = employees.filter((e) => e.status === "active");
  const [employeeId, setEmployeeId] = useState<string>(activeEmployees[0]?.id || "");
  const employee = employees.find((e) => e.id === employeeId);

  // Default the period to the current month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
  const [payDate, setPayDate] = useState(today.toISOString().slice(0, 10));

  const [baseSalary, setBaseSalary] = useState<number>(employee?.base_salary || 0);
  const [commission, setCommission] = useState<number>(0);
  const [bonus, setBonus] = useState<number>(0);
  const [deductions, setDeductions] = useState<number>(0);
  const [paymentMethodId, setPaymentMethodId] = useState<string>(employee?.payment_method_id || methods[0]?.id || "");
  const [notes, setNotes] = useState("");

  // When the employee changes, pull their default base salary + method
  useEffect(() => {
    if (!employee) return;
    setBaseSalary(employee.base_salary || 0);
    setPaymentMethodId(employee.payment_method_id || methods[0]?.id || "");
    setCommission(0);
    setBonus(0);
    setDeductions(0);
  }, [employee, methods]);

  const gross = Math.round((baseSalary + commission + bonus) * 100) / 100;
  const net = Math.round((gross - deductions) * 100) / 100;
  const short = net < 0;

  const inFuture = periodEnd > todayStr();
  const coveringRun = findCoveringRun(runs, periodStart, periodEnd);
  const periodBlocked = inFuture || !coveringRun;

  const empOptions: ComboboxOption[] = activeEmployees.map((e) => ({
    value: e.id,
    label: e.full_name,
    sub: `${e.code}${e.position ? " · " + e.position : ""} · base ${formatMoney(e.base_salary, sym)}`,
  }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) { toast.error("Select an employee"); return; }
    if (gross <= 0) { toast.error("Gross pay must be greater than 0"); return; }
    if (short) { toast.error("Deductions cannot exceed gross pay"); return; }
    if (inFuture) { toast.error("You cannot pay for a period that hasn't ended yet"); return; }
    if (!coveringRun) { toast.error("Start a payroll run for this period first"); return; }

    const fd = new FormData();
    fd.set("employee_id", employeeId);
    fd.set("period_start", periodStart);
    fd.set("period_end", periodEnd);
    fd.set("pay_date", payDate);
    fd.set("base_salary", String(baseSalary));
    fd.set("commission", String(commission));
    fd.set("bonus", String(bonus));
    fd.set("deductions", String(deductions));
    if (paymentMethodId) fd.set("payment_method_id", paymentMethodId);
    if (notes) fd.set("notes", notes);

    start(async () => {
      const r = await createSalaryPayment(fd);
      if (!r.ok) { toast.error(r.error || "Failed to post salary"); return; }
      toast.success("Salary payment posted");
      onClose();
      router.refresh();
    });
  }

  // Helper text for commission hint
  let commissionHint: string | null = null;
  if (employee && Number(employee.commission_rate) > 0) {
    const basisLabel = employee.commission_basis === "sales_total"
      ? "of sales total"
      : employee.commission_basis === "gross_profit"
        ? "of gross profit"
        : "(manual)";
    commissionHint = `${Number(employee.commission_rate).toFixed(2)}% ${basisLabel}`;
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b bg-slate-50 sticky top-0 z-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Wallet className="h-5 w-5 text-emerald-600" />
                New Salary Payment
              </DialogTitle>
              <DialogDescription>
                Posts double-entry: Dr Salaries / Commission / Bonus · Cr Cash or Bank
              </DialogDescription>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-medium">Net Pay</div>
              <div className={`text-2xl font-bold tabular-nums ${short ? "text-red-700" : "text-slate-900"}`}>
                {formatMoney(short ? 0 : net, sym)}
              </div>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="px-6 py-5 space-y-6">
          {/* Employee + Period */}
          <section>
            <SectionTitle>Employee &amp; Period</SectionTitle>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12">
                <Label>Employee *</Label>
                <Combobox
                  value={employeeId}
                  onChange={setEmployeeId}
                  options={empOptions}
                  placeholder="Search active employee..."
                  emptyText="No active employees"
                />
                {employee && (
                  <div className="mt-2 text-xs text-slate-600 inline-flex items-center gap-2">
                    <span><b>{employee.code}</b></span>
                    {employee.department && <span>· {employee.department}</span>}
                    {commissionHint && (
                      <span className="text-emerald-700">· Commission: <b>{commissionHint}</b></span>
                    )}
                  </div>
                )}
              </div>
              <div className="col-span-4">
                <Label htmlFor="period_start">Period Start *</Label>
                <Input id="period_start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
              </div>
              <div className="col-span-4">
                <Label htmlFor="period_end">Period End *</Label>
                <Input id="period_end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
              </div>
              <div className="col-span-4">
                <Label htmlFor="pay_date">Pay Date *</Label>
                <Input id="pay_date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required />
              </div>
              <div className="col-span-12">
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setPeriodStart(firstOfMonth); setPeriodEnd(lastOfMonth); }}>
                    <Calendar className="h-3 w-3" /> This month
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    const last = new Date(today.getFullYear(), today.getMonth(), 0);
                    setPeriodStart(d.toISOString().slice(0, 10));
                    setPeriodEnd(last.toISOString().slice(0, 10));
                  }}>
                    Last month
                  </Button>
                </div>
              </div>
              {inFuture ? (
                <div className="col-span-12 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" /> This period hasn&apos;t ended yet — you can&apos;t pay it.
                </div>
              ) : !coveringRun ? (
                <div className="col-span-12 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" /> No open payroll run covers this period. Start a payroll run first.
                </div>
              ) : (
                <div className="col-span-12 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Covered by payroll run {coveringRun.run_no}.
                </div>
              )}
            </div>
          </section>

          {/* Compensation breakdown */}
          <section>
            <SectionTitle>Compensation</SectionTitle>
            <div className="grid grid-cols-12 gap-3">
              <MoneyField id="base_salary" label="Base Salary" value={baseSalary} onChange={setBaseSalary} />
              <MoneyField id="commission"  label="Commission"  value={commission}  onChange={setCommission} hint={commissionHint || undefined} />
              <MoneyField id="bonus"       label="Bonus"       value={bonus}       onChange={setBonus} />
              <MoneyField id="deductions"  label="Deductions"  value={deductions}  onChange={setDeductions} />
            </div>
          </section>

          {/* Payment method + notes */}
          <section className="grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <Label htmlFor="payment_method_id">Pay Via</Label>
              <Select id="payment_method_id" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                <option value="">— Cash drawer —</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              <p className="text-xs text-slate-500 mt-1">Determines which asset account is credited.</p>
            </div>
            <div className="col-span-6">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </section>

          {/* Totals card */}
          <section>
            <SectionTitle>Summary</SectionTitle>
            <div className="border rounded-lg bg-white p-4 grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-slate-600">Base salary</span>
              <span className="text-right tabular-nums">{formatMoney(baseSalary, sym)}</span>
              <span className="text-slate-600">Commission</span>
              <span className="text-right tabular-nums text-emerald-700">{formatMoney(commission, sym)}</span>
              <span className="text-slate-600">Bonus</span>
              <span className="text-right tabular-nums text-emerald-700">{formatMoney(bonus, sym)}</span>
              <span className="font-semibold border-t border-slate-200 pt-2">Gross</span>
              <span className="text-right tabular-nums font-semibold border-t border-slate-200 pt-2">{formatMoney(gross, sym)}</span>
              <span className="text-slate-600">Deductions</span>
              <span className="text-right tabular-nums text-red-700">−{formatMoney(deductions, sym)}</span>
              <span className="font-bold text-base border-t-2 border-slate-300 pt-2">NET PAY</span>
              <span className={`text-right tabular-nums font-bold text-base border-t-2 border-slate-300 pt-2 ${short ? "text-red-700" : "text-slate-900"}`}>
                {formatMoney(short ? 0 : net, sym)}
              </span>
            </div>
            {short && (
              <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Deductions exceed gross pay
              </div>
            )}
          </section>

          <DialogFooter className="-mx-6 -mb-5 px-6 py-4 border-t bg-slate-50 sm:justify-between sticky bottom-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending || short || gross <= 0 || periodBlocked} size="lg">
              {pending ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Posting...</span>
              ) : (
                <span className="inline-flex items-center gap-2"><Banknote className="h-5 w-5" /> Pay {formatMoney(short ? 0 : net, sym)}</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoneyField({
  id, label, value, onChange, hint,
}: {
  id: string; label: string; value: number;
  onChange: (n: number) => void; hint?: string;
}) {
  return (
    <div className="col-span-6 md:col-span-3">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id} type="number" step="0.01" min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="tabular-nums text-right"
      />
      {hint && <p className="text-[11px] text-emerald-700 mt-0.5">Hint: {hint}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
      {children}
    </h3>
  );
}
