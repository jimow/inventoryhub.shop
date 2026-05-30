import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin browser-side queries to this deployment's tenant schema.
      db: { schema: process.env.NEXT_PUBLIC_TENANT_SCHEMA || "public" },
    }
  );
}
