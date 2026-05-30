import { redirect } from "next/navigation";
import { isInstalled } from "@/lib/tenant";
import { InstallClient } from "./install-client";

// Force Node runtime + no caching: this reads the filesystem install marker.
export const dynamic = "force-dynamic";

export default function InstallPage() {
  if (isInstalled()) redirect("/login");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-4">
      <InstallClient />
    </div>
  );
}
