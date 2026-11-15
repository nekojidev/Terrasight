"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnalysisPanel, Button, InfoHint, type FieldRunStatus } from "@terrasight/ui";
import { Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { dateShortIn, isAutumn, isSameDayIn, timeIn, useNow } from "@/lib/time";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";

interface RunField {
  fieldId: string;
  name: string;
  status: "waiting" | "running" | "ok" | "stale" | "failed";
  dataDate: string | null;
  error: string | null;
}
interface Run {
  id: string | null;
  status?: "running" | "done";
  startedAt?: string;
  finishedAt?: string | null;
  summary?: {
    total: number;
    checked: number;
    newRecommendations: number;
    problems: Array<{
      fieldId: string;
      name: string;
      status: "stale" | "failed";
      error: string | null;
      dataDate: string | null;
    }>;
  } | null;
  fields?: RunField[];
}

const PANEL_STATUS: Record<RunField["status"], FieldRunStatus> = {
  waiting: "waiting",
  running: "running",
  ok: "done",
  stale: "no_data",
  failed: "no_data",
};

/** "Analyze fields", the AnalysisPanel while a run is active, and the last run's summary (S-03.02, S-03.04). */
export function AnalysisCard({
  workspaceId,
  timeZone,
  canRun,
}: {
  workspaceId: string;
  timeZone: string;
  canRun: boolean;
}) {
  const t = useTranslations("App");
  const m = useTranslations("Main");
  const locale = useLocale();
  const client = useQueryClient();
  useWorkspaceEvents(workspaceId, ["analysis"]);
  const key = ["analysis", workspaceId];
  const run = useQuery({
    queryKey: key,
    queryFn: () => api<Run>(`/api/w/${workspaceId}/analysis-runs/latest`),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3_000 : false),
  });
  const start = useMutation({
    mutationFn: (fieldIds?: string[]) =>
      api<Run>(`/api/w/${workspaceId}/analysis-runs`, { body: fieldIds ? { fieldIds } : {} }),
    onSuccess: (r) => client.setQueryData(key, r),
  });

  const r = run.data;
  const running = r?.status === "running" || start.isPending;
  const date = (iso: string) => dateShortIn(iso, locale, timeZone);
  const time = (iso: string) => timeIn(iso, locale, timeZone);
  // "Today" and the season depend on the clock: unknown on the server and the hydration render, set after mount.
  const now = useNow();
  const when =
    r?.finishedAt && now
      ? isSameDayIn(new Date(r.finishedAt), now, timeZone)
        ? t("anToday", { time: time(r.finishedAt) })
        : t("anOn", { date: date(r.finishedAt), time: time(r.finishedAt) })
      : null;
  const autumn = isAutumn(now, timeZone);
  const checks = autumn
    ? [t("anAutumn1"), t("anAutumn2"), t("anAutumn3"), t("anAutumn4")]
    : [t("anSpring1"), t("anSpring2")];
  const retry = (fieldId: string) => start.mutate([fieldId]);
  const reason = (p: { error: string | null }) => p.error ?? m("an_fail");

  return (
    <section aria-live="polite" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-ink-2">
          {r?.id && when && r.summary
            ? t("anLast", { when, n: r.summary.total })
            : !r?.id
              ? t("anNever")
              : null}
        </p>
        {canRun && (
          <span className="inline-flex items-center gap-2">
            <Button
              variant="outline"
              icon={<Play />}
              onClick={() => start.mutate(undefined)}
              disabled={running}
              aria-busy={running}
            >
              {running ? m("analyzing") : m("analyze")}
            </Button>
            <InfoHint label={t("hintLabel")} align="end">
              {t("hintAnalyze")}
            </InfoHint>
          </span>
        )}
      </div>
      {running && r?.fields && (
        <AnalysisPanel
          title={m("analyzing")}
          fields={r.fields.map((f) => ({
            id: f.fieldId,
            name: f.name,
            status: PANEL_STATUS[f.status],
            ...(f.error ? { note: f.error } : {}),
          }))}
          statusLabels={{
            waiting: t("anWaiting"),
            running: t("anRunning"),
            done: t("anOk"),
            no_data: m("an_fail"),
          }}
          seasonTitle={m("an_season")}
          seasonChecks={checks}
          retryLabel={t("retry")}
          onRetry={retry}
        />
      )}
      {!running && r?.summary && (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-body text-ink">
            {t("anDone", {
              checked: r.summary.checked,
              total: r.summary.total,
              n: r.summary.newRecommendations,
            })}
          </p>
          {r.summary.problems.map((p) => (
            <div key={p.fieldId} className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-small ${p.status === "failed" ? "text-urgent" : "text-week"}`}>
                {p.status === "stale" && p.dataDate
                  ? t("anStale", { name: p.name, reason: reason(p), date: date(`${p.dataDate}T12:00:00Z`) })
                  : t("anFailed", { name: p.name, reason: reason(p) })}
              </p>
              {canRun && (
                <Button variant="outline" size={44} onClick={() => retry(p.fieldId)}>
                  {t("anRetryField", { name: p.name })}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {canRun && <p className="text-small text-ink-3">{m("an_auto")}</p>}
    </section>
  );
}
