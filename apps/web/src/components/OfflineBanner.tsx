"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOnline } from "@/lib/offline";

/** Offline card (design 17): shown in the shell while the browser has no connection. */
export function OfflineCard({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" className="flex gap-3 rounded-card border border-line bg-surface p-4">
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-btn bg-week-soft text-week"
      >
        <Clock className="size-5" strokeWidth={1.7} />
      </span>
      <div>
        <p className="text-body font-semibold text-ink">{title}</p>
        <p className="text-small text-ink-2">{body}</p>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  const t = useTranslations("App");
  const online = useOnline();
  if (online) return null;
  return <OfflineCard title={t("offlineTitle")} body={t("offlineBody")} />;
}
