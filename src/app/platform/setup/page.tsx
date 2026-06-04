import { redirect } from "next/navigation";
import { platformHasAdmins } from "@/lib/platform";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function PlatformSetupPage() {
  // Once claimed, setup closes — send people to the login.
  if (await platformHasAdmins()) redirect("/platform/login");
  return <SetupForm />;
}
