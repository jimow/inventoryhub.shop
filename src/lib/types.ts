import type { PermissionMatrix } from "./permissions";

export type Status = "active" | "inactive";
export type SaleStatus = "draft" | "confirmed" | "paid" | "cancelled";
export type SaleType = "cash" | "credit" | "invoice";
export type PurchaseStatus = "draft" | "ordered" | "received" | "paid" | "cancelled";
export type PurchaseType = "cash" | "credit";

export type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: PermissionMatrix;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  role_id: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string;
  cost_price: number;
  selling_price: number;
  current_stock: number;
  min_stock: number;
  taxable: boolean;
  serial_tracked: boolean;
  status: Status;
  created_at: string;
  updated_at: string;
};

/** Serial-level inventory unit (one row per physical unit). */
export type InventoryUnit = {
  id: string;
  product_id: string | null;
  serial_no: string;
  barcode: string | null;
  status: "in_stock" | "sold" | "scrapped" | "returned";
  cost: number;
  purchase_id: string | null;
  purchase_line_idx: number | null;
  sale_id: string | null;
  sale_line_idx: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Customer = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  tax_id: string | null;
  credit_limit: number;
  balance: number;
  status: Status;
  created_at: string;
  updated_at: string;
};

export type Supplier = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  tax_id: string | null;
  payment_terms: string;
  balance: number;
  status: Status;
  created_at: string;
  updated_at: string;
};

export type SaleLine = {
  refId: string;
  name: string;
  qty: number;
  price: number;
  /** For serial_tracked products: which inventory_units are being sold. Length must equal qty. */
  unit_ids?: string[];
};

export type Sale = {
  id: string;
  invoice_no: string;
  date: string;
  customer_id: string | null;
  items: SaleLine[];
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  total: number;
  status: SaleStatus;
  sale_type: SaleType;
  due_date: string | null;
  amount_paid: number;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

export type PurchaseLine = {
  refId: string;
  name: string;
  qty: number;
  price: number;
};

export type Purchase = {
  id: string;
  po_no: string;
  date: string;
  supplier_id: string | null;
  items: PurchaseLine[];
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  total: number;
  status: PurchaseStatus;
  purchase_type: PurchaseType;
  due_date: string | null;
  amount_paid: number;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

export type SettingsData = {
  company: {
    name: string;
    legalName?: string;
    address: string;
    phone: string;
    email: string;
    taxId: string;
    website?: string;
  };
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
  };
  locale?: {
    country?: string;
    language?: string;
    dateFormat?: string;
    timeFormat?: "12h" | "24h";
    weekStart?: number;
    decimalPlaces?: number;
    thousandsSeparator?: string;
    decimalSeparator?: string;
  };
  currency: {
    symbol: string;
    code: string;
    position?: "before" | "after";
    rounding?: "none" | "0.05" | "0.1" | "1" | "5" | "10";
    /** When true, money values render as plain numbers with no currency symbol. */
    hideSymbol?: boolean;
  };
  tax: {
    defaultRate: number;
    name?: string;
    inclusive?: boolean;
    registrationNo?: string;
  };
  pos?: {
    quickAmounts?: number[];
    requireCustomer?: boolean;
    defaultCustomerId?: string | null;
    autoPrintReceipt?: boolean;
    scannerEnter?: boolean;
    confirmCancel?: boolean;
    decimalQty?: boolean;
  };
  receipt?: {
    paperWidth?: "58mm" | "80mm" | "A5";
    header?: string;
    footer?: string;
    returnPolicy?: string;
    showLogo?: boolean;
    showTaxBreakdown?: boolean;
  };
  inventory?: {
    lowStockThreshold?: number;
    allowNegativeStock?: boolean;
    valuationMethod?: "fifo" | "average" | "lifo";
  };
  sales?: {
    defaultType?: "cash" | "credit" | "invoice";
    defaultCreditDays?: number;
    confirmCancel?: boolean;
    allowBackdate?: boolean;
    maxBackdateDays?: number;
  };
  purchases?: {
    defaultCreditDays?: number;
    confirmCancel?: boolean;
    allowBackdate?: boolean;
  };
  accounting?: {
    fiscalYearStartMonth?: number;
    defaultCashAccountCode?: string;
    defaultBankAccountCode?: string;
    defaultRevenueAccountCode?: string;
    defaultCogsAccountCode?: string;
  };
  numbering: {
    invoicePrefix: string;
    poPrefix: string;
    customerPrefix: string;
    supplierPrefix: string;
    productPrefix: string;
    nextInvoice: number;
    nextPO: number;
    nextCustomer: number;
    nextSupplier: number;
    nextProduct: number;
    nextPayment: number;
    nextJournal: number;
    nextSalaryPayment?: number;
    nextPayrollRun?: number;
  };
  productCategories: string[];
  units: string[];
  paymentTerms: string[];
  /** @deprecated use settings.inventory.lowStockThreshold */
  lowStockThreshold?: number;
};

/* ===========================================================================
   POS / Accounting / Payments (added in migration 00005)
   =========================================================================== */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  is_system: boolean;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type BankAccount = {
  id: string;
  name: string;
  bank_name: string | null;
  account_no: string | null;
  currency: string;
  opening_balance: number;
  account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PaymentMethodKind = "cash" | "mpesa" | "bank" | "card" | "other";

/** Free-form per-method config; for M-Pesa: { transaction_type, shortcode, label }. */
export type PaymentMethodMeta = {
  transaction_type?: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  shortcode?: string;
  label?: string;
  [k: string]: unknown;
};

export type PaymentMethod = {
  id: string;
  name: string;
  kind: PaymentMethodKind;
  bank_account_id: string | null;
  requires_ref: boolean;
  is_active: boolean;
  meta: PaymentMethodMeta;
  created_at: string;
  updated_at: string;
};

export type PaymentDirection = "in" | "out";
export type PaymentSource = "sale" | "purchase" | "other";

export type Payment = {
  id: string;
  payment_no: string;
  date: string;
  direction: PaymentDirection;
  source_type: PaymentSource;
  sale_id: string | null;
  purchase_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  payment_method_id: string | null;
  amount: number;
  /** For cash payments: how much the customer handed over. */
  tendered_amount: number | null;
  /** For cash payments: change_due = tendered_amount - amount. */
  change_due: number | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

export type MpesaStkStatus = "pending" | "success" | "failed" | "cancelled" | "timeout";

export type MpesaStk = {
  id: string;
  checkout_request_id: string;
  merchant_request_id: string | null;
  sale_id: string | null;
  amount: number;
  phone: string;
  account_reference: string | null;
  status: MpesaStkStatus;
  result_code: number | null;
  result_desc: string | null;
  mpesa_receipt_no: string | null;
  payment_id: string | null;
  raw_request: unknown;
  raw_callback: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type JournalSourceType = "manual" | "sale" | "purchase" | "payment";

export type JournalEntry = {
  id: string;
  entry_no: string;
  date: string;
  description: string | null;
  source_type: JournalSourceType;
  source_id: string | null;
  created_at: string;
  created_by: string | null;
};

export type JournalLine = {
  id: string;
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
};

/* ===========================================================================
   Employees & Payroll (migration 00015)
   =========================================================================== */

export type EmployeeStatus = "active" | "inactive" | "terminated";
export type CommissionBasis = "manual" | "sales_total" | "gross_profit";

export type Employee = {
  id: string;
  code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  national_id: string | null;
  department: string | null;
  position: string | null;
  hire_date: string;
  termination_date: string | null;
  base_salary: number;
  /** Commission percentage (0-100). */
  commission_rate: number;
  commission_basis: CommissionBasis;
  payment_method_id: string | null;
  bank_account_no: string | null;
  status: EmployeeStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SalaryPaymentStatus = "draft" | "posted" | "cancelled";

export type SalaryPayment = {
  id: string;
  payment_no: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  base_salary: number;
  commission: number;
  bonus: number;
  deductions: number;
  gross: number;
  net: number;
  payment_method_id: string | null;
  journal_entry_id: string | null;
  run_id: string | null;
  status: SalaryPaymentStatus;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

export type PayrollRunStatus = "draft" | "approved" | "posted" | "cancelled";

export type PayrollRun = {
  id: string;
  run_no: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: PayrollRunStatus;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  approved_by: string | null;
  approved_at: string | null;
  posted_by: string | null;
  posted_at: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};
