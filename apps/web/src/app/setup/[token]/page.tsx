import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { serverGet } from "@/lib/server-api";
import { SetupForm } from "./SetupForm";

/** The one-time "set your password" link created by the company owner (PD v2.9). */
export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await getTranslations("App");
  const info = await serverGet<{ name: string; email: string }>(
    `/api/auth/setup/${encodeURIComponent(token)}`,
  );
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <LanguageSwitch />
      </header>
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
        {info.ok ? (
          <div className="flex flex-col gap-5">
            <h1 className="text-h1 text-ink">{a("setupTitle")}</h1>
            <p className="text-body text-ink-2">
              {a("setupSub", { name: info.data.name, email: info.data.email })}
            </p>
            <SetupForm token={token} />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <p role="alert" className="text-body text-ink">
              {a("setupInvalid")}
            </p>
            <Link
              href="/login"
              className="focus-ring inline-flex min-h-14 items-center justify-center rounded-btn bg-ink px-6 text-body font-semibold text-surface"
            >
              {a("setupSignIn")}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
