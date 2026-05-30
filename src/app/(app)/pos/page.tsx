import { createClient } from "@/lib/supabase/server";
import { getCurrentSession, requireViewPermission } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { PosClient } from "./pos-client";
import type { Product, Customer, PaymentMethod, SettingsData } from "@/lib/types";

export default async function PosPage() {
  await requireViewPermission("pos");
  await getCurrentSession();
  const supabase = await createClient();
  const [{ data: products }, { data: customers }, { data: methods }] = await Promise.all([
    supabase.from("products").select("*").eq("status", "active").order("name"),
    supabase.from("customers").select("*").eq("status", "active").order("name"),
    supabase.from("payment_methods").select("*").eq("is_active", true).order("name"),
  ]);
  const settings = await getSettings();
  return (
    <PosClient
      products={(products as Product[]) || []}
      customers={(customers as Customer[]) || []}
      methods={(methods as PaymentMethod[]) || []}
      settings={settings}
    />
  );
}
