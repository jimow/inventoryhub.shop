"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformSetup } from "../login/actions";

export function SetupForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await platformSetup(fd);
      if (!r.ok) { setError(r.error || "Setup failed."); return; }
      router.push("/platform");
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-900 to-[#0b1220] p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg ring-1 ring-white/15">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-white">Set up the Platform Console</h1>
          <p className="text-sm text-slate-400">
            No super-admin exists yet. Create the first platform administrator.
          </p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          {error && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" autoComplete="name" placeholder="e.g. Jamal Derow" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
            <p className="mt-1 text-xs text-slate-500">
              If you already have a login (e.g. a shop admin), enter it to promote that account. Otherwise a new
              super-admin account is created.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Setting up…" : "Create platform administrator"}
          </Button>
        </form>
      </div>
    </div>
  );
}
