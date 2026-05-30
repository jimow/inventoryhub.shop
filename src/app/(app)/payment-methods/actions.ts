"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth";
import type { PaymentMethodKind } from "@/lib/types";

type Result = { ok: boolean; error?: string };

function readPayload(fd: FormData) {
  const kind = String(fd.get("kind") || "cash") as PaymentMethodKind;
  const meta: Record<string, unknown> = {};
  if (kind === "mpesa") {
    const tx = String(fd.get("mpesa_transaction_type") || "");
    if (tx === "CustomerPayBillOnline" || tx === "CustomerBuyGoodsOnline") {
      meta.transaction_type = tx;
    }
    const shortcode = String(fd.get("mpesa_shortcode") || "").trim();
    if (shortcode) meta.shortcode = shortcode;
    if (meta.transaction_type === "CustomerBuyGoodsOnline") {
      meta.label = "Lipa Na M-Pesa Online · Buy Goods (Till)";
    } else if (meta.transaction_type === "CustomerPayBillOnline") {
      meta.label = "Lipa Na M-Pesa Online · PayBill";
    }
  }
  return {
    name: String(fd.get("name") || "").trim(),
    kind,
    bank_account_id: String(fd.get("bank_account_id") || "") || null,
    requires_ref: fd.get("requires_ref") === "on" || fd.get("requires_ref") === "true",
    is_active: fd.get("is_active") === "on" || fd.get("is_active") === "true",
    meta,
  };
}

export async function createPaymentMethod(fd: FormData): Promise<Result> {
  try {
    await requirePermission("accounting", "create");
    const payload = readPayload(fd);
    if (!payload.name) return { ok: false, error: "Name is required" };
    const supabase = await createClient();
    const { error } = await supabase.from("payment_methods").insert(payload);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/payment-methods");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updatePaymentMethod(id: string, fd: FormData): Promise<Result> {
  try {
    await requirePermission("accounting", "edit");
    const payload = readPayload(fd);
    if (!payload.name) return { ok: false, error: "Name is required" };
    const supabase = await createClient();
    const { error } = await supabase.from("payment_methods").update(payload).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/payment-methods");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deletePaymentMethod(id: string): Promise<Result> {
  try {
    await requirePermission("accounting", "delete");
    const supabase = await createClient();
    const { error } = await supabase.from("payment_methods").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/payment-methods");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
