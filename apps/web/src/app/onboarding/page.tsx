import { redirect } from "next/navigation";
import { SessionRefresher } from "@/components/SessionRefresher";
import { serverGet, type Me } from "@/lib/server-api";
import { OnboardingWizard } from "./OnboardingWizard";

/** Design 02. One user = one company (PD v2.12): a user who already has a company goes home. */
export default async function OnboardingPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/onboarding" />;
    redirect("/login");
  }
  if (me.data.workspaces.length > 0) redirect("/");
  return <OnboardingWizard />;
}
