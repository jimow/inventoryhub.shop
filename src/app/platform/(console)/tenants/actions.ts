"use server";

import { revalidatePath } from "next/cache";
import {
  createPlatformClient,
  getPlatformSession,
  logPlatformAction,
  type TenantStatus,
} from "@/lib/platform";
import { provisionTenant } from "@/lib/provisioning";

export type ActionResult = { ok: boolean; error?: string };
export type CreateResult = ActionResult & { tenantId?: string };

const VALID: TenantStatus[] = ["active", "read_only", "suspended", "locked"];

/** Change a workspace's lifecycle status (active / read_only / suspended / locked). */
export async function changeTenantStatus(
  tenantId: string,
  status: TenantStatus,
  reason: string
): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };
  if (!VALID.includes(status)) return { ok: false, error: "Invalid status." };

  const admin = createPlatformClient();
  const { data: tenant } = await admin.from("tenants").select("name, status").eq("id", tenantId).maybeSingle();
  if (!tenant) return { ok: false, error: "Workspace not found." };

  const cleanReason = reason.trim();
  const { error } = await admin
    .from("tenants")
    .update({
      status,
      status_reason: cleanReason || null,
      status_changed_at: new Date().toISOString(),
      status_changed_by: session.userId,
    })
    .eq("id", tenantId);
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({
    action: `tenant.${status}`,
    tenantId,
    tenantName: tenant.name as string,
    detail: { from: tenant.status, to: status, reason: cleanReason },
  });

  revalidatePath("/platform");
  revalidatePath("/platform/tenants");
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true };
}

/** Provision a brand-new workspace (tenant + seed data + admin login). */
export async function createWorkspace(formData: FormData): Promise<CreateResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const s = (k: string) => String(formData.get(k) || "").trim();
  const name = s("name");
  const slug = s("slug").toLowerCase();
  const adminEmail = s("admin_email");
  const adminPassword = String(formData.get("admin_password") || "");
  const adminName = s("admin_name");

  if (!name) return { ok: false, error: "Workspace name is required." };
  if (slug && !/^[a-z][a-z0-9_]{1,40}$/.test(slug)) {
    return { ok: false, error: "Slug must be lower_snake_case (e.g. shop_mombasa)." };
  }
  if (!adminEmail) return { ok: false, error: "Admin email is required." };
  if (adminPassword.length < 8) return { ok: false, error: "Admin password must be at least 8 characters." };

  const overrides: Record<string, unknown> = {
    company: { name, email: adminEmail },
  };
  const curSymbol = s("currency_symbol");
  const curCode = s("currency_code");
  if (curSymbol || curCode) {
    overrides.currency = { symbol: curSymbol || "$", code: curCode || "USD", position: "before" };
  }

  const res = await provisionTenant({
    name,
    slug: slug || undefined,
    overrides,
    admin: { email: adminEmail, password: adminPassword, fullName: adminName || undefined },
  });
  if (!res.ok || !res.tenantId) return { ok: false, error: res.error || "Provisioning failed." };

  await logPlatformAction({
    action: "tenant.created",
    tenantId: res.tenantId,
    tenantName: name,
    detail: { slug, adminEmail },
  });

  revalidatePath("/platform");
  revalidatePath("/platform/tenants");
  return { ok: true, tenantId: res.tenantId };
}

/** Rename / re-tag a workspace. */
export async function updateWorkspace(
  tenantId: string,
  fields: { name?: string; slug?: string; plan?: string }
): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const patch: Record<string, unknown> = {};
  if (fields.name != null) {
    if (!fields.name.trim()) return { ok: false, error: "Name cannot be empty." };
    patch.name = fields.name.trim();
  }
  if (fields.slug != null) {
    const slug = fields.slug.trim().toLowerCase();
    if (slug && !/^[a-z][a-z0-9_]{1,40}$/.test(slug)) {
      return { ok: false, error: "Slug must be lower_snake_case." };
    }
    patch.slug = slug || null;
  }
  if (fields.plan != null) patch.plan = fields.plan.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  const admin = createPlatformClient();
  const { error } = await admin.from("tenants").update(patch).eq("id", tenantId);
  if (error) return { ok: false, error: error.message };

  await logPlatformAction({ action: "tenant.updated", tenantId, tenantName: (patch.name as string) ?? null, detail: patch });
  revalidatePath("/platform/tenants");
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true };
}

/** Permanently delete a workspace and ALL of its data. Requires exact name match. */
export async function deleteWorkspace(tenantId: string, confirmName: string): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const admin = createPlatformClient();
  const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (!tenant) return { ok: false, error: "Workspace not found." };
  if (confirmName.trim() !== tenant.name) {
    return { ok: false, error: "Confirmation name does not match. Deletion cancelled." };
  }

  const { error } = await admin.rpc("platform_delete_tenant", { p_tenant: tenantId });
  if (error) return { ok: false, error: `Delete failed: ${error.message}` };

  await logPlatformAction({ action: "tenant.deleted", tenantId, tenantName: tenant.name as string, detail: {} });
  revalidatePath("/platform");
  revalidatePath("/platform/tenants");
  return { ok: true };
}

/** Save free-form internal notes against a workspace. */
export async function updateTenantNotes(tenantId: string, notes: string): Promise<ActionResult> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Not authorized." };

  const admin = createPlatformClient();
  const { error } = await admin.from("tenants").update({ notes: notes.trim() || null }).eq("id", tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/platform/tenants/${tenantId}`);
  return { ok: true };
}
