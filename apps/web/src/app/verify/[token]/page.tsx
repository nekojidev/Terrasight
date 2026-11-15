import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { VerifyClient } from "./VerifyClient";

/** The email-verification link. The token is spent by a POST from the page, never by a GET (mail scanners). */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await getTranslations("App");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <LanguageSwitch />
      </header>
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-5">
          <h1 className="text-h1 text-ink">{a("verifyTitle")}</h1>
          <VerifyClient token={token} />
        </div>
      </section>
    </main>
  );
}
