"use client";

import { Disclosure } from "@terrasight/ui";
import { AlertTriangle, CalendarClock, Info } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export interface Notice {
  id: string;
  tone: "info" | "week" | "urgent";
  title: string;
  body?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

export interface NoticeStackProps {
  /** In priority order: the first one is shown, the rest fold into "N more notes". */
  notices: Notice[];
  moreLabel?: string;
  className?: string;
}

const TONE = {
  info: { box: "bg-info-soft", icon: "text-info", Icon: Info, word: "toneInfo" },
  week: { box: "bg-week-soft", icon: "text-week", Icon: CalendarClock, word: "toneWeek" },
  urgent: { box: "bg-urgent-soft", icon: "text-urgent", Icon: AlertTriangle, word: "toneUrgent" },
} as const;

function NoticeRow({ n }: { n: Notice }) {
  const t = useTranslations("System");
  const s = TONE[n.tone];
  const cls = "focus-ring inline-flex min-h-tap items-center text-body font-semibold text-ink underline underline-offset-4";
  return (
    <div
      role={n.tone === "urgent" ? "alert" : "note"}
      data-notice={n.id}
      className={`flex gap-3 rounded-card p-4 ${s.box}`}
    >
      <s.Icon aria-hidden strokeWidth={1.7} className={`mt-0.5 size-5 shrink-0 ${s.icon}`} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">
          <span className="sr-only">{t(s.word)}: </span>
          {n.title}
        </p>
        {n.body && <p className="mt-1 text-body text-ink-2">{n.body}</p>}
        {n.action &&
          (n.action.href ? (
            <Link href={n.action.href} className={cls}>
              {n.action.label}
            </Link>
          ) : (
            <button type="button" onClick={n.action.onClick} className={cls}>
              {n.action.label}
            </button>
          ))}
      </div>
    </div>
  );
}

/** One visible notice per screen: the first, with the rest folded into an "N more notes" disclosure. */
export function NoticeStack({ notices, moreLabel, className }: NoticeStackProps) {
  const t = useTranslations("System");
  if (!notices.length) return null;
  const [first, ...rest] = notices;
  return (
    <div className={className} data-testid="notice-stack">
      <NoticeRow n={first!} />
      {rest.length > 0 && (
        <Disclosure summary={<span className="text-small">{moreLabel ?? t("moreNotes", { n: rest.length })}</span>}>
          <div className="flex flex-col gap-2 pb-2">
            {rest.map((n) => (
              <NoticeRow key={n.id} n={n} />
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
