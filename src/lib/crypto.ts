// Server-only. Symmetric vault for secrets at rest (SSH keys/passwords).
// AES-256-GCM with a key derived from PLATFORM_SECRET_KEY (falls back to the
// service-role key so it works out of the box, though a dedicated
// PLATFORM_SECRET_KEY is strongly recommended in production).

import crypto from "node:crypto";

function masterKey(): Buffer {
  const secret =
    process.env.PLATFORM_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "insecure-dev-key-change-me";
  // Derive a stable 32-byte key. Static salt is fine: the secret is the entropy.
  return crypto.scryptSync(secret, "platform.vault.v1", 32);
}

/** Encrypt plaintext → "v1:<iv>:<tag>:<cipher>" (all base64). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value produced by encryptSecret. Returns null on any failure. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [v, ivB64, tagB64, dataB64] = payload.split(":");
    if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
