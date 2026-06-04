"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "./actions";
import { toast } from "sonner";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const result =
        mode === "signin" ? await signIn(fd) : await signUp(fd);
      if (!result.ok) {
        toast.error(result.error || "Login failed");
        return;
      }
      if (mode === "signup") {
        toast.success("Account created. Check your email if confirmation is required, then sign in.");
        setMode("signin");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      // Next.js 15 throws redirect() as an Error whose .digest starts with
      // "NEXT_REDIRECT". Re-throw so Next handles the navigation cleanly
      // instead of us showing it as a toast.
      const e = err as { digest?: string; message?: string };
      if (e?.digest?.startsWith("NEXT_REDIRECT") || e?.message === "NEXT_REDIRECT") {
        throw err;
      }
      toast.error(e?.message || "Unexpected error during sign-in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-[420px] max-w-[96%] bg-white rounded-2xl shadow-2xl p-9">
      <div className="flex items-center justify-center gap-2 text-blue-800 text-2xl font-bold">
        <Boxes className="h-6 w-6" />
        <span>Inventory MS</span>
      </div>
      <p className="text-center text-sm text-slate-500 mt-1 mb-6">
        {mode === "signin" ? "Sign in to your account" : "Create your account"}
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full Name</Label>
            <Input id="full_name" name="full_name" autoComplete="name" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Please wait..." : mode === "signin" ? "Sign In" : "Sign Up"}
        </Button>
      </form>

      <div className="mt-4 text-center text-sm text-slate-500">
        {mode === "signin" ? (
          <>
            Don&apos;t have an account?{" "}
            <button
              type="button"
              className="text-blue-700 font-medium hover:underline"
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already registered?{" "}
            <button
              type="button"
              className="text-blue-700 font-medium hover:underline"
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-slate-400 text-center mt-6">
        First user automatically becomes the Administrator.
      </p>

      <div className="mt-4 pt-4 border-t text-center">
        <a href="/platform" className="text-xs text-slate-400 hover:text-slate-600">
          Platform administrator? Open the console →
        </a>
      </div>
    </div>
  );
}
