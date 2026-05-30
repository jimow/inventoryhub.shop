// Server-only Daraja (Safaricom M-Pesa) client.
//
// Exposes:
//   getAccessToken()           – cached OAuth token via consumer key/secret
//   stkPush(opts)              – Lipa Na M-Pesa STK push (PayBill or Till)
//   stkQuery(checkoutRequestId)– Poll Daraja for the final STK result
//   normalizeKenyanPhone(p)    – Format any input ("07XX...","254...","+254...") to "2547XX..."
//
// Env vars (set in .env.local). Sandbox defaults are used when blank so you can
// test out-of-the-box; only DARAJA_CALLBACK_URL is REQUIRED (must be public HTTPS).
//
//   DARAJA_ENV                 sandbox | production       (default: sandbox)
//   DARAJA_CONSUMER_KEY                                   (required for prod; sandbox has known test keys but they rotate, supply your own)
//   DARAJA_CONSUMER_SECRET
//   DARAJA_SHORTCODE           default sandbox PayBill 174379
//   DARAJA_PASSKEY             default sandbox passkey bfb279f9aa9bdbcf...
//   DARAJA_TRANSACTION_TYPE    CustomerPayBillOnline | CustomerBuyGoodsOnline (default: PayBill)
//   DARAJA_CALLBACK_URL        Public HTTPS url Daraja will POST to (REQUIRED)

import "server-only";

const SANDBOX = "https://sandbox.safaricom.co.ke";
const PROD    = "https://api.safaricom.co.ke";

/** Lipa Na M-Pesa Online sandbox PayBill + passkey published by Safaricom. */
const SANDBOX_DEFAULTS = {
  shortcode: "174379",
  passkey:   "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
};

export type DarajaTransactionType = "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";

export function darajaBaseUrl(): string {
  return (process.env.DARAJA_ENV || "sandbox").toLowerCase() === "production" ? PROD : SANDBOX;
}

function darajaConfig(overrides?: { shortcode?: string; transactionType?: DarajaTransactionType }) {
  const env = (process.env.DARAJA_ENV || "sandbox").toLowerCase();
  const isSandbox = env !== "production";
  const cfg = {
    env,
    isSandbox,
    key:           process.env.DARAJA_CONSUMER_KEY || "",
    secret:        process.env.DARAJA_CONSUMER_SECRET || "",
    shortcode:     overrides?.shortcode || process.env.DARAJA_SHORTCODE || (isSandbox ? SANDBOX_DEFAULTS.shortcode : ""),
    passkey:       process.env.DARAJA_PASSKEY || (isSandbox ? SANDBOX_DEFAULTS.passkey : ""),
    txType:        (overrides?.transactionType || process.env.DARAJA_TRANSACTION_TYPE || "CustomerPayBillOnline") as DarajaTransactionType,
    callbackUrl:   process.env.DARAJA_CALLBACK_URL || "",
  };

  // Consumer key + secret must always come from your own Daraja app (even
  // sandbox: Safaricom rotates the public-test creds, so we don't ship them).
  const missing: string[] = [];
  if (!cfg.key)         missing.push("DARAJA_CONSUMER_KEY");
  if (!cfg.secret)      missing.push("DARAJA_CONSUMER_SECRET");
  if (!cfg.shortcode)   missing.push("DARAJA_SHORTCODE");
  if (!cfg.passkey)     missing.push("DARAJA_PASSKEY");
  if (!cfg.callbackUrl) missing.push("DARAJA_CALLBACK_URL");
  if (missing.length) {
    throw new Error(
      `Daraja config missing: ${missing.join(", ")}. Add them to .env.local and restart the server.`
    );
  }

  // Daraja rejects http://, localhost / 127.0.0.1, and unfilled placeholders.
  validateCallbackUrl(cfg.callbackUrl);
  return cfg;
}

function validateCallbackUrl(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error(`DARAJA_CALLBACK_URL is not a valid URL: ${url}`); }
  if (parsed.protocol !== "https:") {
    throw new Error("DARAJA_CALLBACK_URL must use https:// — Daraja refuses plain http.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.startsWith("127.") || host.startsWith("0.0.0.0") || host.endsWith(".local")) {
    throw new Error(
      "DARAJA_CALLBACK_URL cannot point to localhost. Use a public tunnel (ngrok / cloudflared / loca.lt) and set the public URL."
    );
  }
  if (host.includes("your-tunnel") || host.includes("example") || url.includes("YOUR-")) {
    throw new Error("DARAJA_CALLBACK_URL is still the placeholder — replace it with your public tunnel URL.");
  }
}

// Module-level token cache (per server process) — Daraja tokens last ~1 hour.
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) return tokenCache.token;

  const env = (process.env.DARAJA_ENV || "sandbox").toLowerCase();
  const key = process.env.DARAJA_CONSUMER_KEY || "";
  const secret = process.env.DARAJA_CONSUMER_SECRET || "";
  if (!key || !secret) throw new Error("DARAJA_CONSUMER_KEY / DARAJA_CONSUMER_SECRET missing in .env.local");

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const base = env === "production" ? PROD : SANDBOX;
  const r = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Daraja OAuth failed: ${r.status} ${await safeText(r)}`);
  const j: { access_token: string; expires_in: string | number } = await r.json();
  if (!j.access_token) throw new Error("Daraja OAuth: no access_token in response");
  const ttlSec = Number(j.expires_in) || 3300;
  tokenCache = { token: j.access_token, expiresAt: now + ttlSec * 1000 };
  return j.access_token;
}

/** YYYYMMDDHHMMSS in Africa/Nairobi (East Africa Time, UTC+3, no DST). */
export function darajaTimestamp(d = new Date()): string {
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    eat.getUTCFullYear().toString() +
    pad(eat.getUTCMonth() + 1) +
    pad(eat.getUTCDate()) +
    pad(eat.getUTCHours()) +
    pad(eat.getUTCMinutes()) +
    pad(eat.getUTCSeconds())
  );
}

export function normalizeKenyanPhone(input: string): string {
  const digits = (input || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0")  && digits.length === 10) return "254" + digits.slice(1);
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return "254" + digits;
  if (digits.startsWith("+254")) return digits.replace("+", "");
  throw new Error(`Phone "${input}" is not a valid Kenyan number. Use 07XX..., 01XX..., or 2547XX...`);
}

export type StkPushInput = {
  amount: number;
  phone: string;
  accountReference: string;
  description: string;
  callbackUrl?: string;
  /** Per-call override; falls back to env DARAJA_TRANSACTION_TYPE. */
  transactionType?: DarajaTransactionType;
  /** Per-call override of the receiving shortcode (e.g. for Till vs PayBill). */
  shortcode?: string;
};

export type StkPushResult = {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
};

export async function stkPush(input: StkPushInput): Promise<StkPushResult & { request: Record<string, unknown> }> {
  const cfg = darajaConfig({ shortcode: input.shortcode, transactionType: input.transactionType });
  const token = await getAccessToken();
  const ts = darajaTimestamp();
  const password = Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString("base64");
  const phone = normalizeKenyanPhone(input.phone);
  const amount = Math.max(1, Math.round(Number(input.amount)));

  // Sandbox max is 70,000 KES per transaction (per Safaricom docs).
  if (cfg.isSandbox && amount > 70_000) {
    throw new Error(`Sandbox max is 70,000 KES — amount ${amount} too high`);
  }

  const body: Record<string, unknown> = {
    BusinessShortCode: cfg.shortcode,
    Password:          password,
    Timestamp:         ts,
    TransactionType:   cfg.txType,
    Amount:            amount,
    PartyA:            phone,
    PartyB:            cfg.shortcode,
    PhoneNumber:       phone,
    CallBackURL:       input.callbackUrl || cfg.callbackUrl,
    AccountReference:  (input.accountReference || "POS").slice(0, 12),
    TransactionDesc:   (input.description || "Sale").slice(0, 13),
  };

  const r = await fetch(`${darajaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ResponseCode !== "0") {
    const detail = data.errorMessage || data.ResponseDescription || data.ResponseDesc || r.statusText || "Unknown error";
    throw new Error(`STK push failed: ${detail}`);
  }
  return { ...data, request: body };
}

export type StkQueryResult = {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
};

export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  const cfg = darajaConfig();
  const token = await getAccessToken();
  const ts = darajaTimestamp();
  const password = Buffer.from(`${cfg.shortcode}${cfg.passkey}${ts}`).toString("base64");

  const r = await fetch(`${darajaBaseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify({
      BusinessShortCode: cfg.shortcode,
      Password:          password,
      Timestamp:         ts,
      CheckoutRequestID: checkoutRequestId,
    }),
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (data.ResultCode !== undefined) return data as StkQueryResult;
  if (data.errorCode) {
    return {
      ResponseCode:        "1",
      ResponseDescription: "Pending",
      MerchantRequestID:   "",
      CheckoutRequestID:   checkoutRequestId,
      ResultCode:          "1037",
      ResultDesc:          data.errorMessage || "Pending user action",
    };
  }
  throw new Error(`STK query failed: ${r.status} ${await safeText(r)}`);
}

async function safeText(r: Response): Promise<string> {
  try { return await r.text(); } catch { return ""; }
}
