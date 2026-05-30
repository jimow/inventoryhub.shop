// Server-only authentication / authorization helpers.
// Imports server-only modules (next/headers via supabase/server) - do NOT
// import from a client component. Use @/lib/permissions for the client-safe
// constants and helpers.

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient, currentTenantId } from "@/lib/supabase/server";
import {
  can,
  type Action,
  type Module,
  type PermissionMatrix,
} from "@/lib/permissions";
import type { Profile, Role } from "./types";

// ---------------------------------------------------------------------------
// Cross-request caches — these survive between navigations so Supabase is
// not queried on every page load after the first warm hit.
// ---------------------------------------------------------------------------

/**
 * Cache the user's profile for 60 s.
 * Throws (instead of returning null) when the profile is missing so the
 * error result is NOT stored in the cache — this lets ensureProfile run
 * on first login without the null being baked in for 60 s.
 */
const fetchCachedProfile = (userId: string) =>
  unstable_cache(
    async (): Promise<Profile> => {
      const admin = createServiceClient();
      const tid = currentTenantId();
      let q = admin.from("profiles").select("*").eq("id", userId);
      // Service role bypasses RLS: ensure the user belongs to THIS tenant.
      if (tid) q = q.eq("tenant_id", tid);
      const { data } = await q.maybeSingle();
      if (!data) throw new Error("profile_not_found");
      return data as Profile;
    },
    [`profile:${userId}`],
    { revalidate: 60, tags: [`profile:${userId}`, "profiles"] }
  )();

/**
 * Cache the role row for 5 minutes.
 * Role permissions change infrequently; admin actions should call
 * revalidateTag(`role:${roleId}`) after updating permissions.
 */
const fetchCachedRole = (roleId: string) =>
  unstable_cache(
    async (): Promise<Role> => {
      const admin = createServiceClient();
      const tid = currentTenantId();
      let q = admin.from("roles").select("*").eq("id", roleId);
      if (tid) q = q.eq("tenant_id", tid);
      const { data } = await q.maybeSingle();
      if (!data) throw new Error("role_not_found");
      return data as Role;
    },
    [`role:${roleId}`],
    { revalidate: 300, tags: [`role:${roleId}`, "roles"] }
  )();

// ---------------------------------------------------------------------------
// Main session helper
// ---------------------------------------------------------------------------

/**
 * Get the signed-in user, their profile, and role.
 * Redirects to /login if no session is found.
 *
 * Performance notes:
 *  - Uses getSession() (local cookie read) instead of getUser() (network
 *    round trip) because the middleware already validates & refreshes the
 *    token on every request — no need to hit the auth server again here.
 *  - Profile and role are fetched via unstable_cache so subsequent page
 *    navigations within the TTL skip those DB queries entirely.
 *  - React cache() deduplicates within a single render pass (layout + page
 *    + requireViewPermission all share one result per request).
 */
export const getCurrentSession = cache(async function _getCurrentSession(): Promise<{
  userId: string;
  profile: Profile;
  role: Role | null;
  permissions: PermissionMatrix;
}> {
  const supabase = await createClient();

  // Local cookie read — no network call. Safe here because middleware runs
  // getUser() first on every request, validating and refreshing the token.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const user = session.user;

  // Profile — cross-request cache; falls back to ensureProfile on first login
  let profile: Profile | null = null;
  try {
    profile = await fetchCachedProfile(user.id);
  } catch {
    profile = await ensureProfile(
      user.id,
      user.email ?? null,
      user.user_metadata?.full_name as string | undefined
    );
  }

  if (!profile) redirect("/login");

  // Role — cross-request cache
  let role: Role | null = null;
  if (profile.role_id) {
    try {
      role = await fetchCachedRole(profile.role_id);
    } catch {
      role = null;
    }
  }

  const permissions = (role?.permissions ?? {}) as PermissionMatrix;
  return { userId: user.id, profile, role, permissions };
});

// ---------------------------------------------------------------------------
// Profile self-heal (first login / trigger failure)
// ---------------------------------------------------------------------------

async function ensureProfile(
  userId: string,
  email: string | null,
  fullName: string | undefined
): Promise<Profile | null> {
  // Use service-role client so we can write even if RLS would deny it.
  const admin = createServiceClient();
  const tid = currentTenantId();

  // Service role bypasses RLS, so scope role/profile lookups to this tenant.
  // Pick Administrator for the very first user of THIS tenant, else Viewer.
  let profileCountQ = admin.from("profiles").select("*", { count: "exact", head: true });
  if (tid) profileCountQ = profileCountQ.eq("tenant_id", tid);
  const { count } = await profileCountQ;
  const isFirst = (count ?? 0) === 0;

  const roleName = isFirst ? "Administrator" : "Viewer";
  let roleQ = admin.from("roles").select("id").eq("name", roleName);
  if (tid) roleQ = roleQ.eq("tenant_id", tid);
  const { data: role } = await roleQ.maybeSingle();
  const role_id: string | null = role?.id ?? null;

  const username = email ? email.split("@")[0] : userId.slice(0, 8);
  const { data, error } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        ...(tid ? { tenant_id: tid } : {}),
        username,
        full_name: fullName || email || username,
        email,
        role_id,
        status: "active",
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) {
    console.error("[ensureProfile] failed to create profile:", error.message);
    return null;
  }
  return data as Profile;
}

// ---------------------------------------------------------------------------
// Permission gates used by server actions and pages
// ---------------------------------------------------------------------------

/**
 * Mutating-action gate. Throws so the calling server action can return a
 * `{ok:false, error}` toast on the client.
 */
export async function requirePermission(module: Module, action: Action) {
  const { permissions } = await getCurrentSession();
  if (!can(permissions, module, action)) {
    throw new Error(
      `Permission denied: you don't have ${action} access to this resource.`
    );
  }
}

/**
 * Page-level gate. Redirects to /forbidden so the user sees a friendly screen
 * instead of a stack trace.
 */
export async function requireViewPermission(module: Module, action: Action = "view") {
  const { permissions } = await getCurrentSession();
  if (!can(permissions, module, action)) {
    redirect(`/forbidden?module=${module}&action=${action}`);
  }
}
