"use client";

import { Button, PageContainer } from "@terrasight/ui";
import { RotateCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

/** Route-level error boundary: what happened, what to do, one action (Try again). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("App");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer width="narrow" className="flex min-h-dvh flex-col justify-center gap-5 py-10">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-btn bg-week-soft text-week"
      >
        <TriangleAlert className="size-6" strokeWidth={1.7} />
      </span>
      <h1 className="text-h1 text-ink">{t("errPageTitle")}</h1>
      <div role="alert" className="flex flex-col gap-1">
        <p className="text-body text-ink">{t("errPageWhat")}</p>
        <p className="text-body text-ink-2">{t("errPageDo")}</p>
      </div>
      <div>
        <Button size={48} icon={<RotateCw />} onClick={reset}>
          {t("tryAgain")}
        </Button>
      </div>
    </PageContainer>
  );
}
