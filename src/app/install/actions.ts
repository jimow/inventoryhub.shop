"use server";

import { isInstalled, saveTenantConfig } from "@/lib/tenant";
import { provisionTenant } from "@/lib/provisioning";

export type InstallResult = { ok: boolean; error?: string; notice?: string };

export async function installTenant(formData: FormData): Promise<InstallResult> {
  try {
    return await runInstall(formData);
  } catch (e) {
    // Never let this bubble up as a 500 — surface the reason in the wizard.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[installTenant] failed:", e);
    return { ok: false, error: `Install failed: ${msg}` };
  }
}

async function runInstall(formData: FormData): Promise<InstallResult> {
  if (isInstalled()) {
    return { ok: false, error: "This deployment is already installed." };
  }

  const s = (k: string) => String(formData.get(k) || "").trim();
  const schema = s("schema").toLowerCase();
  const companyName = s("company_name");
  const adminEmail = s("admin_email");
  const adminPassword = String(formData.get("admin_password") || "");

  if (!companyName) return { ok: false, error: "Company name is required." };
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(schema)) {
    return { ok: false, error: "Schema must be lower_snake_case, 2-41 chars (e.g. shop_mombasa)." };
  }
  if (!adminEmail) return { ok: false, error: "Admin email is required." };
  if (adminPassword.length < 8) return { ok: false, error: "Admin password must be at least 8 characters." };

  const overrides: Record<string, unknown> = {
    company: {
      name: companyName,
      address: s("company_address"),
      phone: s("company_phone"),
      email: s("company_email") || adminEmail,
      taxId: s("company_tax_id"),
    },
  };
  const curSymbol = s("currency_symbol");
  const curCode = s("currency_code");
  if (curSymbol || curCode) {
    overrides.currency = { symbol: curSymbol || "$", code: curCode || "USD", position: "before" };
  }
  const taxRate = Number(formData.get("tax_rate"));
  if (!Number.isNaN(taxRate)) {
    overrides.tax = { defaultRate: Math.max(0, taxRate), name: s("tax_name") || "Tax" };
  }

  const res = await provisionTenant({
    name: companyName,
    slug: schema, // the lower_snake "shop id" doubles as the tenant slug
    overrides,
    admin: {
      email: adminEmail,
      password: adminPassword,
      fullName: s("admin_name") || undefined,
      username: s("admin_username") || undefined,
    },
  });
  if (!res.ok || !res.tenantId) return { ok: false, error: res.error || "Provisioning failed." };

  // Pin this deployment to the new tenant id. If the filesystem is read-only
  // (some hosts), tell the operator to set TENANT_ID in the env instead.
  try {
    saveTenantConfig({ tenantId: res.tenantId, installed: true, companyName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: true,
      notice: `Shop created (tenant ${res.tenantId}), but this server couldn't write its config file ` +
              `(${msg}). Set TENANT_ID=${res.tenantId} in this deployment's environment and restart.`,
    };
  }
  return { ok: true };
}
