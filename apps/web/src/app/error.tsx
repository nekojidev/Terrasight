"use client";

import { Button } from "@terrasight/ui";
import { Home, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

/** Route-level error boundary: the shell stays, the page body is replaced by a calm message with two exits. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("App");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-5 px-6 py-10">
      <span
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-btn bg-week-soft text-week"
      >
        <TriangleAlert className="size-6" strokeWidth={1.7} />
      </span>
      <h1 className="text-h1 text-ink">{t("errPageTitle")}</h1>
      <p role="alert" className="text-body text-ink-2">
        {t("errPageBody")}
      </p>
      {error.digest && <p className="font-mono text-micro text-ink-3">{error.digest}</p>}
      <div className="flex flex-wrap gap-3">
        <Button size={48} icon={<RotateCw />} onClick={reset}>
          {t("tryAgain")}
        </Button>
        <Link
          href="/"
          className="focus-ring inline-flex h-12 items-center gap-2 rounded-btn border border-line-strong bg-surface px-5 text-body font-semibold text-ink hover:bg-surface-2"
        >
          <Home aria-hidden className="size-5" />
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}
