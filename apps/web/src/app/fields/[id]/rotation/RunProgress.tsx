"use client";

import { Skeleton, Surface } from "@terrasight/ui";
import { Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** Seconds since mount, ticking once a second. */
function useElapsed(): number {
  const [s, setS] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setS((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return s;
}

/** Long-operation pattern: what is being calculated, elapsed time, the usual duration. */
export function RunProgress({ agro, compact = false }: { agro: boolean; compact?: boolean }) {
  const r = useTranslations("Rotation");
  const s = useElapsed();
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <Surface tone="inset" pad="lg" role="status" aria-live="polite" className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-h2 text-ink">
        <Loader aria-hidden className="size-5 shrink-0 motion-safe:animate-spin" strokeWidth={1.7} />
        {r("run_title")}
      </p>
      <p className="text-body text-ink-2">{r(agro ? "run_what_agro" : "run_what")}</p>
      <p className="text-caption text-ink-2">
        <span className="font-mono">{r("run_elapsed", { time })}</span> · {r("run_usual")}
      </p>
      {!compact && (
        <div aria-hidden>
          <Skeleton label={r("run_title")} variant="rows" rows={2} />
        </div>
      )}
    </Surface>
  );
}
