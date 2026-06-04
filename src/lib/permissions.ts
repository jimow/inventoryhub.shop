// Client-safe constants, types, and pure helpers.
// Server-only helpers (getCurrentSession, requirePermission) live in @/lib/auth.

export const MODULES = [
  "dashboard",
  "pos",
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
  "returns",
  "payments",
  "employees",
  "payroll",
  "accounting",
  "equity",
  "loans",
  "users",
  "roles",
  "audit",
  "settings",
] as const;

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "post", "balances"] as const;

/** CRUD actions every module supports. */
export const BASE_ACTIONS = ["view", "create", "edit", "delete"] as const;

export type Module = (typeof MODULES)[number];
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  post: "Pay/Post",
  balances: "Balances",
};

/**
 * Actions beyond the base CRUD set, enabled only on modules that have a
 * review / disbursement workflow. `approve` and `post` are meaningless on,
 * say, the dashboard — so they don't appear there.
 */
export const MODULE_EXTRA_ACTIONS: Partial<Record<Module, readonly Action[]>> = {
  payroll: ["approve", "post"],
  payments: ["approve"],
  customers: ["balances"],
  suppliers: ["balances"],
};

/** The full ordered list of actions valid for a given module. */
export function actionsForModule(module: Module): Action[] {
  return [...BASE_ACTIONS, ...(MODULE_EXTRA_ACTIONS[module] ?? [])];
}

/** Whether an action even applies to a module (drives the roles matrix). */
export function moduleSupportsAction(module: Module, action: Action): boolean {
  return actionsForModule(module).includes(action);
}

export type PermissionMatrix = {
  [M in Module]?: { [A in Action]?: boolean };
};

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  pos: "POS",
  products: "Products",
  customers: "Customers",
  suppliers: "Suppliers",
  sales: "Sales",
  purchases: "Purchases",
  returns: "Returns",
  payments: "Payments",
  employees: "Employees",
  payroll: "Payroll",
  accounting: "Accounting",
  equity: "Equity & Shareholders",
  loans: "Loans",
  users: "Users",
  roles: "Roles & Permissions",
  audit: "Activity Log",
  settings: "Settings",
};

export const MODULE_DESCRIPTIONS: Record<Module, string> = {
  dashboard:  "View KPIs, charts and quick links on the home dashboard.",
  pos:        "Use the touch-friendly Point of Sale terminal to ring up cash sales.",
  products:   "Master data for everything you buy and sell: pricing, stock, barcode, SKU.",
  customers:  "Customer master data, credit limits, balances.",
  suppliers:  "Supplier master data, payment terms, balances.",
  sales:      "Create sales / invoices, confirm, cancel, record payments.",
  purchases:  "Create purchase orders, receive stock, record supplier payments.",
  returns:    "Record sales returns and purchase returns with stock + journal reversal.",
  payments:   "Record payments in/out and view full payment ledger.",
  employees:  "Employee directory, commission settings and master data.",
  payroll:    "Start payroll runs and disburse salary payments with double-entry posting.",
  accounting: "Bank accounts, payment methods, chart of accounts, journal, reports.",
  equity:     "Shareholders and their capital contributions / withdrawals.",
  loans:      "Money borrowed from others and lent to others, with repayments.",
  users:      "Add / disable users and assign their roles.",
  roles:      "Define roles and grant per-module permissions.",
  audit:      "View the system activity / audit log of all transactions.",
  settings:   "Company info, currency, tax rate, numbering, categories, units.",
};

export function emptyMatrix(): PermissionMatrix {
  const m: PermissionMatrix = {};
  for (const mod of MODULES) {
    m[mod] = {};
    for (const action of actionsForModule(mod)) m[mod]![action] = false;
  }
  return m;
}

export function can(
  permissions: PermissionMatrix | null | undefined,
  module: Module,
  action: Action
): boolean {
  return Boolean(permissions?.[module]?.[action]);
}
