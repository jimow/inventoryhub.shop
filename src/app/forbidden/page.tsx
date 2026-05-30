import Link from "next/link";
import { ShieldX } from "lucide-react";
import { MODULE_LABELS, type Module } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type SP = Record<string, string | string[] | undefined>;

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams?: Promise<SP>;
}) {
  const sp = (await searchParams) || {};
  const m = (Array.isArray(sp.module) ? sp.module[0] : sp.module) as Module | undefined;
  const a = (Array.isArray(sp.action) ? sp.action[0] : sp.action) as string | undefined;
  const moduleLabel = m && (m in MODULE_LABELS) ? MODULE_LABELS[m] : "this resource";
  const actionLabel = a || "view";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <ShieldX className="h-7 w-7 text-red-600" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Access denied</h1>
        <p className="text-sm text-slate-600 mb-6">
          You don&rsquo;t have <b>{actionLabel}</b> permission for <b>{moduleLabel}</b>.
          Contact an administrator if you believe this is a mistake.
        </p>
        <div className="flex gap-2 justify-center">
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
