"use client";

import { Disclosure } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

export interface EvidenceProps {
  /** One line, always visible while closed: "3 checks · 2 sources · numbers verified". */
  summary: string;
  /** Number of items inside; shown next to the title. */
  count?: number;
  defaultOpen?: boolean;
  /** Anchor id; `#<id>` in the URL opens the section. Default "evidence". */
  id?: string;
  children: ReactNode;
}

/** The one disclosure for proof: decision first, evidence one click away. Remembers nothing; opens by URL hash. */
export function Evidence({ summary, count, defaultOpen = false, id = "evidence", children }: EvidenceProps) {
  const t = useTranslations("System");
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        document.getElementById(id)?.scrollIntoView?.({ block: "start" });
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);
  return (
    <section id={id} className="scroll-mt-20 rounded-card border border-line bg-surface px-4 py-1">
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        id={`${id}-panel`}
        summaryNote={summary}
        summary={
          <span className="inline-flex items-center gap-2">
            {t("evidence")}
            {count !== undefined && <span className="font-mono text-small font-normal text-ink-2">{count}</span>}
          </span>
        }
      >
        <div className="pb-3">{children}</div>
      </Disclosure>
    </section>
  );
}
