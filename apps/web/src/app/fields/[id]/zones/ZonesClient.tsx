"use client";

import { useQuery } from "@tanstack/react-query";
import { Chip } from "@terrasight/ui";
import { Bug, FileText, MessageCircle, Sparkles, Sprout, Tractor, Database } from "lucide-react";
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

/** Zones & yield (design 11). Zone map and yield forecast are a labelled example; the work log is real. */
export function ZonesClient({
  workspaceId,
  fieldId,
  fieldName,
}: {
  workspaceId: string;
  fieldId: string;
  fieldName: string;
}) {
  const t = useTranslations("App");
  const z = useTranslations("Zones");
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
  // Example zone pattern (not this field's data): three bands inside a pivot circle.
  const cells = Array.from({ length: 14 * 14 }, (_, i) => {
    const x = i % 14;
    const y = Math.floor(i / 14);
    const inside = (x - 6.5) ** 2 + (y - 6.5) ** 2 <= 6.5 ** 2;
    const band = x + y < 10 ? "weak" : x - y > 3 || x + y > 19 ? "strong" : "mid";
    return { x, y, inside, band };
  });
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">{fieldName}</h1>
        <FieldTabs fieldId={fieldId} active={1} />
      </header>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <section className="rounded-card border border-line bg-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-h2 text-ink">{z("z_t")}</h2>
                <p className="text-small text-ink-2">{z("z_s")}</p>
              </div>
              <Chip tone="week">{t("znPreview")}</Chip>
            </div>
            <p className="mt-3 rounded-input bg-week-soft p-3 text-small text-ink">{t("znPreviewNote")}</p>
            <div className="mt-4 grid gap-6 md:grid-cols-[260px_1fr]">
              <svg
                viewBox="0 0 140 140"
                role="img"
                aria-label={z("map_label")}
                className="rounded-card bg-ink"
              >
                {cells
                  .filter((c) => c.inside)
                  .map((c) => (
                    <rect
                      key={`${c.x}-${c.y}`}
                      x={c.x * 10}
                      y={c.y * 10}
                      width="10"
                      height="10"
                      className={
                        c.band === "strong" ? "fill-ok" : c.band === "weak" ? "fill-urgent" : "fill-week"
                      }
                    />
                  ))}
              </svg>
              <ul className="flex flex-col gap-3 text-small">
                {[
                  ["strong", z("zh"), z("zh_s"), "bg-ok"],
                  ["mid", z("zu"), z("zu_s"), "bg-week"],
                  ["weak", z("zl"), z("zl_s"), "bg-urgent"],
                ].map(([k, title, sub, color]) => (
                  <li key={k} className="flex items-start gap-3">
                    <span aria-hidden className={`mt-1 size-3 shrink-0 rounded-[3px] ${color}`} />
                    <span>
                      <span className="block font-semibold text-ink">{title}</span>
                      <span className="text-ink-2">{sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="rounded-card border border-line bg-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-h2 text-ink">{z("y_t")}</h2>
              <Chip tone="week">{t("znPreview")}</Chip>
            </div>
            <p className="mt-2 text-small text-ink-2">{z("y_note")}</p>
          </section>
        </div>
        <aside className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-3 text-h2 text-ink">{z("log_t")}</h2>
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
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-3 text-h2 text-ink">{z("int_t")}</h2>
            {[
              [<Tractor key="t" />, z("int_jd"), z("int_jd_s")],
              [<Database key="d" />, z("int_api"), ""],
            ].map(([icon, title, sub], i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <span
                  aria-hidden
                  className="inline-flex size-9 items-center justify-center rounded-chip bg-muted [&>svg]:size-4"
                >
                  {icon}
                </span>
                <span className="flex-1">
                  <span className="block text-body font-semibold text-ink">{title}</span>
                  {sub && <span className="text-small text-ink-2">{sub}</span>}
                </span>
                <Chip tone="neutral">{z("soon")}</Chip>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
