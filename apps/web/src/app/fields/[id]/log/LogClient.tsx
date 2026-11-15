"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoHint, Skeleton, Surface } from "@terrasight/ui";
import { Bug, FileText, MessageCircle, Sparkles, Sprout } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";
import { FieldTabs } from "../Overview";
import { cropLabel, groupBy } from "./group";

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

/** Work log of a field: its real events (checks, scouting, report, owner answers, plans), newest first, by day. */
export function LogClient({
  workspaceId,
  fieldId,
  fieldName,
  timeZone,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
  timeZone?: string | undefined;
}) {
  const t = useTranslations("App");
  const w = useTranslations("Zones");
  const fmt = useFormat();
  const router = useRouter();
  const log = useQuery({
    queryKey: ["field", workspaceId, fieldId, "log"],
    queryFn: () => api<LogEntry[]>(`/api/w/${workspaceId}/fields/${fieldId}/log`),
  });
  // Crop names come with the field history (the same call the field page makes).
  const history = useQuery({
    queryKey: ["field", workspaceId, fieldId, "history"],
    queryFn: () =>
      api<{ cropNames?: Record<string, { en: string; uk: string }> }>(
        `/api/w/${workspaceId}/fields/${fieldId}/history`,
      ),
    staleTime: 10 * 60_000,
  });
  const tz = timeZone ? { timeZone } : undefined;
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
    return t("znLog_plan", {
      season: Number(d.season),
      crop: cropLabel(d.crop, history.data?.cropNames, fmt.locale, w("zn5_cropUnknown")),
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">{fieldName}</h1>
        <FieldTabs fieldId={fieldId} active={1} />
      </header>
      <Surface as="section" className="max-w-[760px]">
        <h2 className="mb-3 text-h2 text-ink">
          {t("tabLog")} <InfoHint label={t("hintLabel")}>{t("hintSeasonNow")}</InfoHint>
        </h2>
        <QueryState
          query={log}
          what={w("zn5_what")}
          skeleton={<Skeleton variant="rows" rows={3} label={w("zn5_loading")} />}
          isEmpty={(d) => d.length === 0}
          empty={{ text: t("znLogEmpty"), actionLabel: t("znLogEmptyAction"), onAction: () => router.push(`/fields/${fieldId}`) }}
        >
          {(entries) => (
            <div className="flex flex-col gap-5">
              {groupBy(entries, (e) => fmt.date(e.at, "full", tz)).map((g) => (
                <section key={g.label}>
                  <h3 className="kicker mb-2">{g.label}</h3>
                  <ol className="flex flex-col gap-3">
                    {g.items.map((e, i) => (
                      <li key={`${e.at}-${i}`} className="flex gap-3">
                        <span
                          aria-hidden
                          className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip bg-muted text-ink [&>svg]:size-5"
                        >
                          {ICON[e.kind]}
                        </span>
                        <span>
                          <span className="block text-caption font-semibold text-ink-2">{w(`zn5_kind_${e.kind}`)}</span>
                          <span className="block text-body font-semibold text-ink">{text(e)}</span>
                          <span className="text-small text-ink-2">
                            {fmt.date(e.at, "time", tz)} · {t(`znSrc_${e.source}`)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </QueryState>
      </Surface>
    </div>
  );
}
