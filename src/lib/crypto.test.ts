import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

describe("secret vault (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const plain = "super-secret-ssh-private-key-0123456789";
    const enc = encryptSecret(plain);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("returns null for missing / malformed / tampered payloads", () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    // Replace the ciphertext segment → GCM auth tag must reject it.
    const parts = encryptSecret("hello world").split(":");
    parts[3] = Buffer.from("a-totally-different-ciphertext").toString("base64");
    expect(decryptSecret(parts.join(":"))).toBeNull();
  });

  it("preserves unicode and long values", () => {
    const s = "pâsswörd–✓ " + "x".repeat(5000);
    expect(decryptSecret(encryptSecret(s))).toBe(s);
  });
});
