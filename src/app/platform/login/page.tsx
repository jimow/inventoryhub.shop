import { redirect } from "next/navigation";
import { getPlatformSession, platformHasAdmins } from "@/lib/platform";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function PlatformLoginPage() {
  if (await getPlatformSession()) redirect("/platform");
  // Nobody has claimed the platform yet → first-run setup.
  if (!(await platformHasAdmins())) redirect("/platform/setup");
  return <LoginForm />;
}
