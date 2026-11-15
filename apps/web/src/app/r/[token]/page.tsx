import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { serverGet } from "@/lib/server-api";
import type { PublicDecisions } from "@terrasight/shared";
import designEn from "../../../../messages/en.json";
import designUk from "../../../../messages/uk.json";
import appEn from "../../../messages/app.en.json";
import appUk from "../../../messages/app.uk.json";
import { ReportLinkClient } from "./ReportLinkClient";

export const metadata: Metadata = { title: "Terrasight", robots: { index: false, follow: false } };

const MESSAGES = {
  en: { ...designEn, ...appEn },
  uk: { ...designUk, ...appUk },
};

/** Design 16: the Owner report through a report link — no app chrome, read and answer only (S-08.03). */
export default async function ReportLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await serverGet<PublicDecisions>(`/api/r/${encodeURIComponent(token)}`);
  if (!report.ok) {
    // The API answers 404 for an unknown, expired or revoked link (it does not say which). The link's language is
    // unknown here, so the message is shown in both languages.
    const gone = report.status === 404;
    return (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center gap-6 bg-canvas p-6">
        {(["uk", "en"] as const).map((l) => (
          <section key={l} lang={l} role={gone ? undefined : "alert"}>
            <h1 className="text-h2 text-ink">
              {MESSAGES[l].App[gone ? "rpExpiredTitle" : "rpUnavailTitle"]}
            </h1>
            <p className="mt-1 text-body text-ink-2">
              {MESSAGES[l].App[gone ? "rpExpiredBody" : "rpUnavailBody"]}
            </p>
          </section>
        ))}
      </main>
    );
  }
  // The language comes from the link, not from the visitor's cookie.
  const locale = report.data.language;
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <div lang={locale}>
        <ReportLinkClient token={token} initial={report.data} />
      </div>
    </NextIntlClientProvider>
  );
}
