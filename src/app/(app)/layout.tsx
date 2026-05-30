import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { NavProgress } from "@/components/nav-progress";
import { getCurrentSession } from "@/lib/auth";
import { getSettings } from "@/lib/numbering";
import { isInstalled, activeSchema } from "@/lib/tenant";
import { SettingsProvider } from "@/lib/settings-context";
import { setLocaleFromSettings } from "@/lib/utils";

function isRedirect(e: unknown): boolean {
  return typeof (e as { digest?: string })?.digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Fresh deployment that hasn't been set up yet → run the install wizard.
  if (!isInstalled()) redirect("/install");

  // Run auth and settings in parallel — neither depends on the other.
  let session, settings;
  try {
    [session, settings] = await Promise.all([getCurrentSession(), getSettings()]);
  } catch (e) {
    if (isRedirect(e)) throw e; // let /login (or other) redirects happen
    // The tenant schema's tables aren't reachable — almost always because the
    // schema isn't exposed to the API yet. Show actionable guidance, not a 500.
    return <SchemaNotReady schema={activeSchema()} detail={(e as Error)?.message} />;
  }
  const { profile, role, permissions } = session;
  // Server-side locale cache for any server component that calls formatMoney/formatDate
  setLocaleFromSettings(settings);

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-white border rounded-xl p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Account pending</h1>
          <p className="mt-2 text-sm text-slate-600">
            Hi {profile.full_name || profile.email}, your account is signed in but no role has been assigned.
            An administrator needs to assign you a role before you can access the system.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SettingsProvider value={settings}>
      <div className="min-h-screen">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <Sidebar permissions={permissions} settings={settings} />
        <Topbar
          user={{
            name: profile.full_name || profile.username || profile.email || "",
            role: role.name,
          }}
        />
        <main className="md:ml-60 pt-14">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </SettingsProvider>
  );
}

/** Shown when the tenant schema exists but its tables aren't reachable via the
 *  API — almost always because the schema isn't in PostgREST's exposed list. */
function SchemaNotReady({ schema, detail }: { schema: string; detail?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-lg bg-white border rounded-xl p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Almost there — finish exposing this shop</h1>
        <p className="mt-2 text-sm text-slate-600">
          The shop database schema <b className="font-mono">{schema}</b> exists, but the API can&apos;t
          see its tables yet. On hosted Supabase you expose a schema once:
        </p>
        <ol className="mt-3 list-decimal pl-5 text-sm text-slate-700 space-y-1">
          <li>Open Supabase → <b>Settings → API → Exposed schemas</b>.</li>
          <li>Add <b className="font-mono">{schema}</b> and click <b>Save</b> (the API reloads automatically).</li>
          <li>Come back and refresh this page.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          To automate this for future shops, set <span className="font-mono">SUPABASE_ACCESS_TOKEN</span> in
          this deployment&apos;s environment, or run <span className="font-mono">npm run expose:tenant -- {schema}</span>.
        </p>
        {detail && <p className="mt-3 text-[11px] text-slate-400 break-words">Details: {detail}</p>}
      </div>
    </div>
  );
}
