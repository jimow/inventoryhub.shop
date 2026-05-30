"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

export async function signIn(formData: FormData): Promise<Result> {
  let mustRedirect = false;
  try {
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    if (!email || !password) return { ok: false, error: "Email and password are required" };

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/", "layout");
    mustRedirect = true;
  } catch (e) {
    const msg = (e as Error).message || "Sign-in failed";
    if (msg === "NEXT_REDIRECT") throw e;
    if (msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
      return {
        ok: false,
        error: "Cannot reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL in .env.local and that your machine is online.",
      };
    }
    return { ok: false, error: msg };
  }
  if (mustRedirect) redirect("/dashboard");
  return { ok: true };
}

export async function signUp(formData: FormData): Promise<Result> {
  try {
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const fullName = String(formData.get("full_name") || "").trim();
    if (!email || !password) return { ok: false, error: "Email and password are required" };

    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message || "Sign-up failed";
    if (msg === "NEXT_REDIRECT") throw e;
    if (msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
      return { ok: false, error: "Cannot reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL in .env.local." };
    }
    return { ok: false, error: msg };
  }
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // best-effort
  }
}
