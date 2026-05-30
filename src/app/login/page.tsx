import { redirect } from "next/navigation";
import { isInstalled } from "@/lib/tenant";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!isInstalled()) redirect("/install");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-700 to-blue-500 p-4">
      <LoginForm />
    </div>
  );
}
