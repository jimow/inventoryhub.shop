// Server-only. Provisions a new shop in the shared-tenancy model: creates a
// `tenants` row, seeds its baseline (roles, settings, chart of accounts,
// payment methods), creates the first admin login, and links the admin profile.
//
// No schema creation and no API exposure — everything lives in `public`, which
// is always exposed. The deployment is then pinned to the returned tenant id
// via TENANT_ID / the install config.
import { createClient } from "@supabase/supabase-js";

export type ProvisionInput = {
  /** Display name of the shop. */
  name: string;
  /** Optional URL-safe slug (unique). */
  slug?: string;
  /** settings overrides: { company, currency, tax }. */
  overrides: Record<string, unknown>;
  admin: { email: string; password: string; fullName?: string; username?: string };
};

export type ProvisionResult = { ok: boolean; error?: string; tenantId?: string };

export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return { ok: false, error: "Server missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY." };
  }
  if (!input.name?.trim()) return { ok: false, error: "Shop name is required." };
  if (!input.admin?.email || !input.admin?.password) {
    return { ok: false, error: "Admin email and password are required." };
  }

  const username = input.admin.username || input.admin.email.split("@")[0];
  const fullName = input.admin.fullName || username;

  // Plain service client — NO tenant header, because we're creating a new one.
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Create the tenant + seed its baseline data.
  const { data: tenantId, error: pErr } = await supabase.rpc("provision_tenant_row", {
    p_name: input.name.trim(),
    p_slug: input.slug?.trim() || null,
    p_overrides: input.overrides,
  });
  if (pErr || !tenantId) {
    return { ok: false, error: `Provisioning failed: ${pErr?.message || "no tenant id returned"}. (Apply migrations 00020-00022.)` };
  }
  const tid = String(tenantId);

  // 2) Create (or find) the admin auth user.
  let userId: string | undefined;
  const created = await supabase.auth.admin.createUser({
    email: input.admin.email,
    password: input.admin.password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username },
  });
  if (created.error && /already.*regist|exists/i.test(created.error.message)) {
    let page = 1, found;
    for (;;) {
      const { data: list, error: lerr } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (lerr) return { ok: false, error: `Could not look up existing user: ${lerr.message}` };
      found = list.users.find((u) => u.email?.toLowerCase() === input.admin.email.toLowerCase());
      if (found || list.users.length < 200) break;
      page++;
    }
    if (!found) return { ok: false, error: "Admin email already exists but could not be located." };
    userId = found.id;
  } else if (created.error) {
    return { ok: false, error: `Could not create admin user: ${created.error.message}` };
  } else {
    userId = created.data.user.id;
  }

  // 3) Link the Administrator profile for this tenant.
  const { error: aErr } = await supabase.rpc("create_tenant_admin_row", {
    p_tenant: tid,
    p_user_id: userId,
    p_username: username,
    p_full_name: fullName,
    p_email: input.admin.email,
  });
  if (aErr) return { ok: false, error: `Linking admin failed: ${aErr.message}` };

  return { ok: true, tenantId: tid };
}
