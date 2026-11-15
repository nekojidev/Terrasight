import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ForgotForm } from "./ForgotForm";

/** "Forgot password?": asks for an email; the answer is the same whether or not an account exists. */
export default async function ForgotPage() {
  const a = await getTranslations("App");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <LanguageSwitch />
      </header>
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 text-ink">{a("forgotTitle")}</h1>
          <p className="text-body text-ink-2">{a("forgotSub")}</p>
          <ForgotForm />
        </div>
      </section>
    </main>
  );
}
