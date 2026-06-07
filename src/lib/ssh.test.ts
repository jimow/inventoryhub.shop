import { describe, it, expect } from "vitest";
import { buildEnvFile, SERVER_OP_KEYS } from "@/lib/ssh";

describe("deploy env file", () => {
  it("writes Supabase creds + port, ships UNINSTALLED (no TENANT_ID), platform disabled", () => {
    const env = buildEnvFile({
      appDir: "/var/www/app", appPort: 3000,
      supabaseUrl: "https://example.supabase.co", supabaseAnon: "anon-key",
      supabaseService: "service-key", source: "upload",
    });
    expect(env).toContain("NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co");
    expect(env).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key");
    expect(env).toContain("SUPABASE_SERVICE_ROLE_KEY=service-key");
    expect(env).toContain("PORT=3000");
    // Clean deploy: no tenant pinned ⇒ first visit is /install.
    expect(env).not.toContain("TENANT_ID=");
    // A tenant shop must never expose the super-admin console.
    expect(env).toContain("PLATFORM_CONSOLE_ENABLED=false");
  });
});

describe("server operations registry", () => {
  it("exposes the core one-click operations", () => {
    for (const key of ["app_restart", "app_logs", "nginx_restart", "ssl_renew", "create_swap", "reboot"]) {
      expect(SERVER_OP_KEYS).toContain(key);
    }
  });
});
