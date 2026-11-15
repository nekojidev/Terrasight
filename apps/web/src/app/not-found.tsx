import { PageContainer } from "@terrasight/ui";
import { Compass } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** 404: also what a field or recommendation from another workspace answers (the API hides it). */
export default async function NotFound() {
  const t = await getTranslations("App");
  return (
    <PageContainer width="narrow" className="flex min-h-dvh flex-col justify-center gap-5 py-10">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-btn bg-muted text-ink-2"
      >
        <Compass className="size-6" strokeWidth={1.7} />
      </span>
      <h1 className="text-h1 text-ink">{t("notFoundTitle")}</h1>
      <div className="flex flex-col gap-1">
        <p className="text-body text-ink">{t("notFoundBody")}</p>
        <p className="text-body text-ink-2">{t("notFoundDo")}</p>
      </div>
      <div>
        <Link
          href="/"
          className="focus-ring inline-flex h-12 items-center rounded-btn bg-ink px-5 text-body font-semibold text-surface"
        >
          {t("goHome")}
        </Link>
      </div>
    </PageContainer>
  );
}
