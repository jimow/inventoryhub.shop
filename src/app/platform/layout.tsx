import { notFound } from "next/navigation";
import { isPlatformConsoleEnabled } from "@/lib/tenant";

// The platform (super-admin) console lives OUTSIDE the (app) tenant group and
// has its own auth. Force dynamic so cookies/session are always read fresh.
export const dynamic = "force-dynamic";

export default function PlatformRootLayout({ children }: { children: React.ReactNode }) {
  // SECURITY: deployed tenant shops must NOT expose the cross-tenant console.
  // On those deployments the console is disabled, so every /platform route 404s.
  if (!isPlatformConsoleEnabled()) notFound();
  return <>{children}</>;
}
