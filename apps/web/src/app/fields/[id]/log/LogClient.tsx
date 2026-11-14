"use client";

import { useQuery } from "@tanstack/react-query";
import { Bug, FileText, MessageCircle, Sparkles, Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { FieldTabs } from "../Overview";

interface LogEntry {
  kind: "check" | "scouting" | "report" | "answer" | "plan";
  at: string;
  source: "assistant" | "you" | "owner";
  data: Record<string, unknown>;
}

const ICON = {
  check: <Sparkles />,
  scouting: <Bug />,
  report: <FileText />,
  answer: <MessageCircle />,
  plan: <Sprout />,
} as const;

/** Work log of a field: its real events (checks, scouting, report, owner answers, plans), newest first. */
export function LogClient({
  workspaceId,
  fieldId,
  fieldName,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const log = useQuery({
    queryKey: ["field", workspaceId, fieldId, "log"],
    queryFn: () => api<LogEntry[]>(`/api/w/${workspaceId}/fields/${fieldId}/log`),
  });
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const text = (e: LogEntry) => {
    const d = e.data;
    if (e.kind === "check")
      return t("znLog_check", { status: String(d.status), n: Number(d.newRecommendations ?? 0) });
    if (e.kind === "scouting") return t("znLog_scouting", { pct: Number(d.pct ?? 0) });
    if (e.kind === "report") return t("znLog_report");
    if (e.kind === "answer")
      return t("znLog_answer", {
        answer: d.text ? `“${String(d.text)}”` : t(`rpAnswer_${String(d.answer)}` as "rpAnswer_done"),
      });
    return t("znLog_plan", { season: Number(d.season), crop: String(d.crop).replace(/_/g, " ") });
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">{fieldName}</h1>
        <FieldTabs fieldId={fieldId} active={1} />
      </header>
      <section className="max-w-[760px] rounded-card border border-line bg-surface p-6">
        <h2 className="mb-3 text-h2 text-ink">{t("tabLog")}</h2>
        {log.data?.length ? (
          <ol className="flex flex-col gap-4">
            {log.data.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-chip bg-muted text-ink [&>svg]:size-4"
                >
                  {ICON[e.kind]}
                </span>
                <span>
                  <span className="block text-body font-semibold text-ink">{text(e)}</span>
                  <span className="text-small text-ink-2">
                    {date(e.at)} · {t(`znSrc_${e.source}`)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-small text-ink-2">{t("znLogEmpty")}</p>
        )}
      </section>
    </div>
  );
}
