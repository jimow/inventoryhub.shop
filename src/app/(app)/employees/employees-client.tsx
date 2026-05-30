"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, UserPlus, Percent, Briefcase } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

import { DataTable, type Column, type FilterDef } from "@/components/data-table";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";

import type { Employee, EmployeeStatus, PaymentMethod, SettingsData } from "@/lib/types";
import type { PermissionMatrix } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { formatMoney, formatDate, currencySymbol } from "@/lib/utils";
import { createEmployee, updateEmployee, deleteEmployee } from "./actions";

const STATUS_OPTIONS = [
  { value: "active",     label: "Active" },
  { value: "inactive",   label: "Inactive" },
  { value: "terminated", label: "Terminated" },
];

export function EmployeesClient({
  employees, totalCount, methods, settings, permissions,
}: {
  employees: Employee[];
  totalCount: number;
  methods: PaymentMethod[];
  settings: SettingsData;
  permissions: PermissionMatrix;
}) {
  const [editing, setEditing] = useState<Employee | null>(null);
  const [adding, setAdding] = useState(false);
  const sym = currencySymbol(settings);

  // Distinct departments — used to power the filter dropdown
  const departments = Array.from(
    new Set(employees.map((e) => e.department).filter(Boolean) as string[])
  ).sort();

  const columns: Column<Employee>[] = [
    { key: "code", label: "Code", className: "w-[120px] font-mono text-xs text-slate-600" },
    {
      key: "full_name", label: "Name",
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.full_name}</div>
          {r.position && <div className="text-xs text-slate-500">{r.position}</div>}
        </div>
      ),
    },
    { key: "department", label: "Department", className: "w-[140px]" },
    { key: "email", label: "Contact",
      render: (r) => (
        <div className="text-xs">
          {r.email && <div className="text-slate-700">{r.email}</div>}
          {r.phone && <div className="text-slate-500">{r.phone}</div>}
        </div>
      ),
    },
    {
      key: "base_salary", label: "Salary", className: "w-[130px] text-right tabular-nums",
      render: (r) => formatMoney(r.base_salary, sym),
    },
    {
      key: "commission_rate", label: "Commission", className: "w-[120px] text-right",
      render: (r) => Number(r.commission_rate) > 0
        ? <span className="tabular-nums text-emerald-700"><Percent className="h-3 w-3 inline -mt-0.5" />{Number(r.commission_rate).toFixed(2)}</span>
        : <span className="text-slate-300">—</span>,
    },
    {
      key: "status", label: "Status", className: "w-[100px]",
      render: (r) => {
        const v = ({ active: "success", inactive: "secondary", terminated: "danger" } as const)[r.status];
        return <Badge variant={v}>{r.status}</Badge>;
      },
    },
  ];

  const filters: FilterDef[] = [
    { key: "status", label: "Status", options: STATUS_OPTIONS },
  ];
  if (departments.length > 0) {
    filters.push({
      key: "department", label: "Department",
      options: departments.map((d) => ({ value: d, label: d })),
    });
  }

  return (
    <div>
      <PageHeader title="Employees" description="Staff directory · salary · commission settings">
        {can(permissions, "employees", "create") && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" /> New Employee
          </Button>
        )}
      </PageHeader>

      <DataTable<Employee>
        columns={columns}
        data={employees}
        totalCount={totalCount}
        searchPlaceholder="Search by name, code, email, phone..."
        filters={filters}
        rowActions={(row) => (
          <>
            {can(permissions, "employees", "edit") && (
              <Button variant="ghost" size="icon" onClick={() => setEditing(row)} title="Edit" className="h-8 w-8">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {can(permissions, "employees", "delete") && (
              <DeleteButton
                action={() => deleteEmployee(row.id)}
                message="If this employee has salary payments, they'll be marked as terminated instead of deleted."
              />
            )}
          </>
        )}
      />

      {(adding || editing) && (
        <EmployeeDialog
          employee={editing}
          methods={methods}
          settings={settings}
          onClose={() => { setAdding(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function EmployeeDialog({
  employee, methods, settings, onClose,
}: {
  employee: Employee | null;
  methods: PaymentMethod[];
  settings: SettingsData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [commissionBasis, setCommissionBasis] = useState(employee?.commission_basis || "manual");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = employee ? await updateEmployee(employee.id, fd) : await createEmployee(fd);
      if (!r.ok) { toast.error(r.error || "Save failed"); return; }
      toast.success(employee ? "Employee updated" : "Employee created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b bg-slate-50">
          <DialogTitle className="text-xl flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-slate-600" />
            {employee ? `Edit Employee ${employee.code}` : "New Employee"}
          </DialogTitle>
          <DialogDescription>
            Master data + commission settings for payroll
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="px-6 py-5 space-y-6">
          {/* Personal */}
          <section>
            <SectionTitle>Personal</SectionTitle>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label htmlFor="code">Employee Code</Label>
                <Input id="code" name="code" defaultValue={employee?.code || ""} placeholder="(auto)" readOnly={!!employee} />
              </div>
              <div className="col-span-9">
                <Label htmlFor="full_name">Full Name *</Label>
                <Input id="full_name" name="full_name" defaultValue={employee?.full_name || ""} required />
              </div>
              <div className="col-span-6">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={employee?.email ?? ""} />
              </div>
              <div className="col-span-3">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" defaultValue={employee?.phone ?? ""} />
              </div>
              <div className="col-span-3">
                <Label htmlFor="national_id">National ID</Label>
                <Input id="national_id" name="national_id" defaultValue={employee?.national_id ?? ""} />
              </div>
            </div>
          </section>

          {/* Employment */}
          <section>
            <SectionTitle>Employment</SectionTitle>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <Label htmlFor="position">Position / Job Title</Label>
                <Input id="position" name="position" defaultValue={employee?.position ?? ""} placeholder="e.g. Sales Associate" />
              </div>
              <div className="col-span-6">
                <Label htmlFor="department">Department</Label>
                <Input id="department" name="department" defaultValue={employee?.department ?? ""} placeholder="e.g. Sales" />
              </div>
              <div className="col-span-4">
                <Label htmlFor="hire_date">Hire Date *</Label>
                <Input id="hire_date" name="hire_date" type="date"
                  defaultValue={employee?.hire_date || new Date().toISOString().slice(0, 10)} required />
              </div>
              <div className="col-span-4">
                <Label htmlFor="termination_date">Termination Date</Label>
                <Input id="termination_date" name="termination_date" type="date"
                  defaultValue={employee?.termination_date ?? ""} />
              </div>
              <div className="col-span-4">
                <Label htmlFor="status">Status</Label>
                <Select id="status" name="status" defaultValue={employee?.status || "active"}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="terminated">Terminated</option>
                </Select>
              </div>
            </div>
          </section>

          {/* Compensation */}
          <section>
            <SectionTitle>Compensation</SectionTitle>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <Label htmlFor="base_salary">Base Salary (monthly)</Label>
                <Input id="base_salary" name="base_salary" type="number" step="0.01" min="0"
                  defaultValue={employee?.base_salary ?? 0} className="tabular-nums" />
              </div>
              <div className="col-span-4">
                <Label htmlFor="commission_rate">Commission Rate (%)</Label>
                <Input id="commission_rate" name="commission_rate" type="number" step="0.01" min="0" max="100"
                  defaultValue={employee?.commission_rate ?? 0} className="tabular-nums" />
              </div>
              <div className="col-span-4">
                <Label htmlFor="commission_basis">Commission Basis</Label>
                <Select id="commission_basis" name="commission_basis"
                  value={commissionBasis}
                  onChange={(e) => setCommissionBasis(e.target.value as typeof commissionBasis)}>
                  <option value="manual">Manual (set per payment)</option>
                  <option value="sales_total">% of Sales Total</option>
                  <option value="gross_profit">% of Gross Profit</option>
                </Select>
              </div>
              <div className="col-span-12 -mt-1">
                <p className="text-xs text-slate-500">
                  {commissionBasis === "manual" && "Commission amount entered manually when creating a salary payment."}
                  {commissionBasis === "sales_total" && "Commission = (rate %) × total sales for the pay period (informational; you confirm per payment)."}
                  {commissionBasis === "gross_profit" && "Commission = (rate %) × gross profit for the pay period (informational; you confirm per payment)."}
                </p>
              </div>
            </div>
          </section>

          {/* Payment */}
          <section>
            <SectionTitle>Payment</SectionTitle>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <Label htmlFor="payment_method_id">Default Payment Method</Label>
                <Select id="payment_method_id" name="payment_method_id" defaultValue={employee?.payment_method_id ?? ""}>
                  <option value="">— Select method —</option>
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </div>
              <div className="col-span-6">
                <Label htmlFor="bank_account_no">Bank Account #</Label>
                <Input id="bank_account_no" name="bank_account_no" defaultValue={employee?.bank_account_no ?? ""} />
              </div>
            </div>
          </section>

          {/* Notes */}
          <section>
            <SectionTitle>Notes</SectionTitle>
            <Textarea name="notes" rows={3} defaultValue={employee?.notes ?? ""}
              placeholder="Internal notes about this employee" className="resize-none" />
          </section>

          <DialogFooter className="-mx-6 -mb-5 px-6 py-4 border-t bg-slate-50 sm:justify-between sticky bottom-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : (employee ? "Save Changes" : "Add Employee")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
      {children}
    </h3>
  );
}

// Keep formatDate available for potential future use without warning
void formatDate;
