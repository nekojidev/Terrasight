import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/AuthShell";
import { ResetForm } from "./ResetForm";

/** The one-time password-reset link from the email. */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await getTranslations("App");
  return (
    <AuthShell>
      <h1 className="text-h1 text-ink">{a("resetTitle")}</h1>
      <ResetForm token={token} />
    </AuthShell>
  );
}
