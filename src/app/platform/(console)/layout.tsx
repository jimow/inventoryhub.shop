import { requirePlatformAdmin } from "@/lib/platform";
import { PlatformShell } from "@/components/platform/platform-shell";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <PlatformShell admin={{ name: admin.name, email: admin.email }}>
      {children}
    </PlatformShell>
  );
}
