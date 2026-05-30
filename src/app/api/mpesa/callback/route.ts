// POST /api/mpesa/callback
//
// Daraja calls this URL once the customer has acted on the STK push prompt
// (PIN entered, cancelled, or it timed out). The route is public — Daraja's
// servers must reach it without auth — but we restrict writes to a service-role
// supabase client so RLS still protects the rest of the schema.
//
// Daraja payload shape (see https://developer.safaricom.co.ke):
// {
//   "Body": {
//     "stkCallback": {
//       "MerchantRequestID": "...",
//       "CheckoutRequestID": "...",
//       "ResultCode": 0,
//       "ResultDesc": "The service request is processed successfully.",
//       "CallbackMetadata": {
//         "Item": [
//           { "Name": "Amount",            "Value": 1 },
//           { "Name": "MpesaReceiptNumber","Value": "PGI..." },
//           { "Name": "TransactionDate",   "Value": 20260504104530 },
//           { "Name": "PhoneNumber",       "Value": 254712345678 }
//         ]
//       }
//     }
//   }
// }

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { reserveNextNumber } from "@/lib/numbering";
import { postPaymentJournal, recomputeSaleStatus } from "@/lib/accounting";

type CbItem = { Name: string; Value: string | number };
type StkCallback = {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode?: number;
  ResultDesc?: string;
  CallbackMetadata?: { Item?: CbItem[] };
};

export async function POST(req: Request) {
  let raw: { Body?: { stkCallback?: StkCallback } } = {};
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 200 });
  }

  const cb = raw?.Body?.stkCallback;
  if (!cb || !cb.CheckoutRequestID) {
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored (no CheckoutRequestID)" });
  }

  const admin = createServiceClient();

  const items = cb.CallbackMetadata?.Item || [];
  const get = (n: string) => items.find((i) => i.Name === n)?.Value;
  const mpesaReceipt = String(get("MpesaReceiptNumber") || "");
  const cbAmount     = Number(get("Amount") || 0);
  const cbPhone      = String(get("PhoneNumber") || "");

  // Look up the originating STK row (created when we initiated the push).
  const { data: stk } = await admin
    .from("mpesa_stk")
    .select("*")
    .eq("checkout_request_id", cb.CheckoutRequestID)
    .single();

  if (!stk) {
    // We don't recognize this CheckoutRequestID — still ack so Daraja stops retrying.
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Unknown CheckoutRequestID" });
  }

  // Idempotency: if we already finalized this row, acknowledge silently.
  if (stk.status !== "pending") {
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" });
  }

  const success = Number(cb.ResultCode) === 0;
  const status: "success" | "failed" | "cancelled" =
    success ? "success" : (cb.ResultCode === 1032 ? "cancelled" : "failed");

  // Update the STK row with the callback result.
  await admin.from("mpesa_stk").update({
    status,
    result_code: cb.ResultCode ?? null,
    result_desc: cb.ResultDesc ?? null,
    mpesa_receipt_no: mpesaReceipt || null,
    raw_callback: raw,
    updated_at: new Date().toISOString(),
  }).eq("id", stk.id);

  if (!success) {
    // Cancel the linked draft sale so stock isn't held.
    if (stk.sale_id) {
      await admin.from("sales").update({ status: "cancelled" }).eq("id", stk.sale_id);
    }
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Failure recorded" });
  }

  // ----- SUCCESS PATH -----
  // 1) Move the sale from draft -> confirmed and deduct stock.
  // 2) Create a payment row referencing the M-Pesa receipt.
  // 3) Post both journals (sale + payment) and refresh status.
  if (stk.sale_id) {
    const { data: sale } = await admin.from("sales").select("*").eq("id", stk.sale_id).single();
    if (sale) {
      // Stock deduction (only if it was a draft until now — confirmed sales already deducted).
      if (sale.status === "draft") {
        for (const l of (sale.items || []) as { refId: string; qty: number }[]) {
          const { data: p } = await admin.from("products").select("current_stock").eq("id", l.refId).single();
          if (p) {
            await admin.from("products")
              .update({ current_stock: Number(p.current_stock) - Number(l.qty) })
              .eq("id", l.refId);
          }
        }
        await admin.from("sales").update({ status: "confirmed" }).eq("id", sale.id);
        await postSaleJournalSafe(sale.id);
      }

      // Prefer the exact method the cashier picked (PayBill vs Till); fall back
      // to the first active M-Pesa method.
      let pm: { id: string } | null = null;
      if (stk.payment_method_id) {
        const { data } = await admin
          .from("payment_methods")
          .select("id")
          .eq("id", stk.payment_method_id)
          .single();
        pm = data ?? null;
      }
      if (!pm) {
        const { data } = await admin
          .from("payment_methods")
          .select("id")
          .eq("kind", "mpesa")
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .single();
        pm = data ?? null;
      }

      // Lookup the method's meta to write a descriptive notes line.
      let methodMeta: { transaction_type?: string; shortcode?: string } = {};
      if (pm?.id) {
        const { data: pmFull } = await admin
          .from("payment_methods")
          .select("meta")
          .eq("id", pm.id)
          .single();
        if (pmFull?.meta) methodMeta = pmFull.meta as typeof methodMeta;
      }
      const flavour = methodMeta.transaction_type === "CustomerBuyGoodsOnline"
        ? `Till ${methodMeta.shortcode ?? ""}`
        : `PayBill ${methodMeta.shortcode ?? ""}`;
      const notesLine = `Lipa Na M-Pesa Online · ${flavour} · phone ${cbPhone || stk.phone}${mpesaReceipt ? ` · receipt ${mpesaReceipt}` : ""}`;

      const payment_no = await reserveNextNumberSafe();
      const { data: payment } = await admin.from("payments").insert({
        payment_no,
        date: new Date().toISOString().slice(0, 10),
        direction: "in",
        source_type: "sale",
        sale_id: sale.id,
        customer_id: sale.customer_id,
        payment_method_id: pm?.id ?? null,
        amount: cbAmount || Number(stk.amount),
        reference: mpesaReceipt || null,
        notes: notesLine,
      }).select("*").single();

      if (payment) {
        await postPaymentJournal(payment);
        await admin.from("mpesa_stk").update({ payment_id: payment.id }).eq("id", stk.id);
        await recomputeSaleStatus(sale.id);
      }
    }
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}

// Some helpers wrap the throwing variants so a problem in the post-callback
// finalization doesn't cause Daraja to retry forever.
async function postSaleJournalSafe(sale_id: string) {
  try {
    const admin = createServiceClient();
    const { data: sale } = await admin.from("sales").select("*").eq("id", sale_id).single();
    if (sale) {
      const { postSaleJournal, postCogsJournal } = await import("@/lib/accounting");
      await postSaleJournal(sale);
      await postCogsJournal(sale);
    }
  } catch (e) {
    console.error("[mpesa callback] failed to post sale journal:", e);
  }
}

async function reserveNextNumberSafe(): Promise<string> {
  try {
    return await reserveNextNumber("nextPayment", "PMT-");
  } catch {
    return "PMT-" + Date.now().toString(36).toUpperCase();
  }
}

// Daraja health-check: GET should respond 200 so the callback URL test passes.
export async function GET() {
  return NextResponse.json({ ok: true, route: "mpesa-callback" });
}
