import { redirect } from "next/navigation";
import { SessionRefresher } from "@/components/SessionRefresher";
import { serverGet, type Me } from "@/lib/server-api";
import { OnboardingWizard } from "./OnboardingWizard";

/** Design 02. A user with a workspace goes home unless they explicitly add another company (?new=1). */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/onboarding" />;
    redirect("/login");
  }
  const { new: addAnother } = await searchParams;
  if (me.data.workspaces.length > 0 && addAnother !== "1") redirect("/");
  return <OnboardingWizard />;
}
