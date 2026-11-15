import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/AuthShell";
import { ForgotForm } from "./ForgotForm";

/** "Forgot password?": asks for an email; the answer is the same whether or not an account exists. */
export default async function ForgotPage() {
  const a = await getTranslations("App");
  return (
    <AuthShell>
      <h1 className="text-h1 text-ink">{a("forgotTitle")}</h1>
      <p className="text-body text-ink-2">{a("forgotSub")}</p>
      <ForgotForm />
    </AuthShell>
  );
}
