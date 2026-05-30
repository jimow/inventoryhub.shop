import { redirect } from "next/navigation";
import { isInstalled } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect(isInstalled() ? "/dashboard" : "/install");
}
