// Client-safe platform types & constants (NO server-only imports). Both client
// components and the server-only @/lib/platform may import from here.

export type TenantStatus = "active" | "read_only" | "suspended" | "locked";

export const TENANT_STATUS_META: Record<
  TenantStatus,
  { label: string; description: string; badge: "success" | "warning" | "danger" | "secondary"; blocks: boolean }
> = {
  active:    { label: "Active",    description: "Full access. Everything works normally.",                         badge: "success",   blocks: false },
  read_only: { label: "Read-only", description: "Users can view data but cannot create, edit or delete anything.",  badge: "warning",   blocks: false },
  suspended: { label: "Suspended", description: "Access is temporarily blocked. Users see a suspension notice.",    badge: "warning",   blocks: true  },
  locked:    { label: "Locked",    description: "Access is fully locked. Users cannot sign in to the workspace.",   badge: "danger",    blocks: true  },
};

export type TenantOverviewRow = {
  id: string;
  name: string;
  slug: string | null;
  status: TenantStatus;
  status_reason: string | null;
  created_at: string;
  users: number;
  products: number;
  customers: number;
  suppliers: number;
  sales: number;
  sales_total: number;
  purchases: number;
  purchases_total: number;
  last_activity: string | null;
};
