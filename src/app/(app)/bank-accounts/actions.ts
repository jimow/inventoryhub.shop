"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";

type Result = { ok: boolean; error?: string };

function readPayload(fd: FormData) {
  return {
    name: String(fd.get("name") || "").trim(),
    bank_name: String(fd.get("bank_name") || "") || null,
    account_no: String(fd.get("account_no") || "") || null,
    currency: String(fd.get("currency") || "USD"),
    opening_balance: Number(fd.get("opening_balance") || 0),
    account_id: String(fd.get("account_id") || "") || null,
    is_active: fd.get("is_active") === "on" || fd.get("is_active") === "true",
  };
}

export async function createBankAccount(fd: FormData): Promise<Result> {
  try {
    await requirePermission("accounting", "create");
    const payload = readPayload(fd);
    if (!payload.name) return { ok: false, error: "Name is required" };
    const supabase = await createClient();
    const { error } = await supabase.from("bank_accounts").insert(payload);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/bank-accounts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateBankAccount(id: string, fd: FormData): Promise<Result> {
  try {
    await requirePermission("accounting", "edit");
    const payload = readPayload(fd);
    if (!payload.name) return { ok: false, error: "Name is required" };
    const supabase = await createClient();
    const { error } = await supabase.from("bank_accounts").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/bank-accounts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteBankAccount(id: string): Promise<Result> {
  try {
    await requirePermission("accounting", "delete");
    const supabase = await createClient();
    const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/bank-accounts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Compute current balance = opening_balance + sum(journal lines for linked account) */
export async function bankAccountBalance(id: string): Promise<number> {
  const admin = createServiceClient();
  const { data: ba } = await admin.from("bank_accounts").select("opening_balance, account_id").eq("id", id).single();
  if (!ba) return 0;
  let bal = Number(ba.opening_balance || 0);
  if (ba.account_id) {
    const { data: lines } = await admin.from("journal_lines").select("debit, credit").eq("account_id", ba.account_id);
    bal += (lines || []).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  }
  return bal;
}
