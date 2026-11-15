"use client";

import { useToast } from "@terrasight/ui";
import { Clock, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/useFormat";
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

/** Sticky strip under the top bar while offline: what you see, what is kept, what waits. Info toast when back. */
export function OfflineBanner() {
  const t = useTranslations("App");
  const online = useOnline();
  const toast = useToast();
  const fmt = useFormat();
  // The last moment we knew the network was there is when the data on screen was current.
  const seen = useRef<Date>(new Date());
  const wasOffline = useRef(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setSavedAt(seen.current);
    } else {
      seen.current = new Date();
      if (wasOffline.current) {
        wasOffline.current = false;
        setSavedAt(null);
        toast.show(t("backOnline"), "info");
      }
    }
  }, [online, toast, t]);
  if (online) return null;
  return (
    <div role="status" className="animate-fade flex items-start gap-3 border-b border-line bg-week-soft px-4 py-3 sm:px-8">
      <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-week" strokeWidth={1.7} />
      <p className="text-caption text-ink sm:text-body">
        {savedAt
          ? t("offlineStatus", { time: fmt.date(savedAt, "time") })
          : t("offlineStatusNoTime")}
      </p>
    </div>
  );
}
