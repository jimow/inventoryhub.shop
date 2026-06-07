"use server";

import {
  createPlatformAuthClient,
  createPlatformClient,
  isPlatformAdmin,
  isPlatformConsoleEnabled,
} from "@/lib/platform";

export type PlatformAuthResult = { ok: boolean; error?: string };

const DISABLED: PlatformAuthResult = { ok: false, error: "The platform console is not available on this deployment." };

/** Sign in as a platform super-admin. Verifies Supabase creds AND membership. */
export async function platformLogin(formData: FormData): Promise<PlatformAuthResult> {
  if (!isPlatformConsoleEnabled()) return DISABLED;
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { ok: false, error: "Email and password are required." };

  const supabase = await createPlatformAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, error: "Invalid email or password." };
  }

  if (!(await isPlatformAdmin(data.user.id))) {
    // Not a platform admin — don't leave a tenant session lying around.
    await supabase.auth.signOut();
    return { ok: false, error: "This account is not a platform administrator." };
  }

  return { ok: true };
}

/** Sign out of the platform console. */
export async function platformLogout(): Promise<void> {
  const supabase = await createPlatformAuthClient();
  await supabase.auth.signOut();
}

/**
 * First-run claim: when no platform admins exist yet, the first person to prove
 * ownership of a valid login becomes the platform super-admin. If the email has
 * no auth account yet, one is created.
 */
export async function platformSetup(formData: FormData): Promise<PlatformAuthResult> {
  if (!isPlatformConsoleEnabled()) return DISABLED;
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "").trim();

  if (!email || !password) return { ok: false, error: "Email and password are required." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  const admin = createPlatformClient();

  // Guard: setup is only open until the platform is claimed.
  const { count } = await admin.from("platform_admins").select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    return { ok: false, error: "The platform has already been set up. Please sign in instead." };
  }

  // Try to create the auth user; if it already exists, fall through to sign-in.
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { full_name: name } : undefined,
  });
  const alreadyExists =
    !!created.error &&
    /already|registered|exists/i.test(created.error.message || "");
  if (created.error && !alreadyExists) {
    return { ok: false, error: created.error.message };
  }

  // Establish a session (verifies the password for pre-existing accounts).
  const supabase = await createPlatformAuthClient();
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.user) {
    return {
      ok: false,
      error: alreadyExists
        ? "An account with this email exists but the password is incorrect."
        : "Could not sign in with the new credentials.",
    };
  }

  const { error: insErr } = await admin.from("platform_admins").insert({
    id: signIn.user.id,
    email,
    name: name || null,
    created_by: signIn.user.id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  await admin.from("platform_audit").insert({
    admin_id: signIn.user.id,
    admin_email: email,
    action: "platform.claimed",
    detail: { name },
  });

  return { ok: true };
}
