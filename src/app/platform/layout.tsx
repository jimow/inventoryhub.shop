// The platform (super-admin) console lives OUTSIDE the (app) tenant group and
// has its own auth. Force dynamic so cookies/session are always read fresh.
export const dynamic = "force-dynamic";

export default function PlatformRootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
