"use client";

import { useTranslations } from "next-intl";
import { CropPricesEditor } from "@/components/CropPricesEditor";

/** Settings tab: the company's own crop prices, any crop. */
export function PricesClient({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("App");
  return (
    <section aria-labelledby="cp-title" className="max-w-4xl rounded-card border border-line bg-surface p-5">
      <h2 id="cp-title" className="mb-1 text-h3 text-ink">
        {t("cpTitle")}
      </h2>
      <p className="mb-4 text-small text-ink-2">{t("cpSub")}</p>
      <CropPricesEditor workspaceId={workspaceId} allowAdd />
    </section>
  );
}
