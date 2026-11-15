"use client";

import { LandChip } from "@/components/LandSuitability";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  ErrorCard,
  InfoHint,
  RailCard,
  FieldThumb,
  Skeleton,
  type Factor,
} from "@terrasight/ui";
import { CalendarClock, ChevronDown, CloudRain, Gavel, Plus, ShieldCheck, Snowflake, Sun } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnalysisCard } from "@/components/AnalysisCard";
import { AiMark } from "@/components/AiMark";
import { AskOwnerSheet } from "@/components/AskOwnerSheet";
import { OutlookRailLine } from "@/components/OutlookRailLine";
import { TodayCard } from "@/components/TodayCard";
import { TodayWindows } from "@/components/TodayWindows";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import type { AskOwnerBody, DecisionList } from "@terrasight/shared";
import { briefHeadline, humanizeDates } from "@/lib/brief";
import { greetingKey, useNow } from "@/lib/time";

type Localised = { en: string; uk: string };
interface Item {
  id: string;
  fieldId: string;
  fieldName: string;
  level: "high" | "moderate" | "low" | "none" | "unknown";
  confidence: "high" | "medium" | "low";
  tier: "A" | "B" | "C";
  deadline: string | null;
  planning: boolean;
  irreversible: boolean;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string; weight: number }>;
  evidence: Array<{ source?: string; title?: string | null; kind?: string }>;
  text: { title: Localised; action: Localised; why: Localised };
  textSource?: "ai" | "template" | "edited";
  aiSuggested?: boolean;
  urgency: "urgent" | "this_week" | "all_good";
  more: number;
  seasons: Array<{ season: number; crop: string }>;
  thumb?: string | null;
}
interface Brief {
  date: string;
  timeZone: string;
  counts: { fields: number; urgent: number; thisWeek: number; allGood: number; worthALook?: number };
  daySummary?: { text: Localised; source: "ai" } | null;
  worthALook?: Item[];
  hero: Item | null;
  urgent: Item[];
  thisWeek: Item[];
  allGood: Array<{
    fieldId: string;
    name: string;
    seasons: Array<{ season: number; crop: string }>;
    thumb?: string | null;
    plan: { id: string; title: Localised; deadline: string | null } | null;
    unknown: { id: string; title: Localised } | null;
    /** Land suitability chip: only for land that is not farmland (or limited / marked cropland anyway). */
    land?: "unsuitable" | "limited" | "overridden" | null;
  }>;
  rail: {
    today: { fields: number; checked: number | null; newRecommendations: number | null; urgent: number };
    weather: Array<{
      county: string;
      region: string | null;
      today: { tminC: number | null; tmaxC: number | null; precipMm: number | null } | null;
      nextFrost: { date: string; tminC: number; uncertain: boolean } | null;
      attribution: string | null;
    }>;
    ownerQuestion: { fieldName: string; text: string | null; at: string } | null;
  };
}
interface Done {
  kind: "accept" | "snooze" | "ask";
  undoUntil: string;
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The morning brief (design 04, S-04.03): what to do first today, with Accept / Snooze and 8 s Undo in place. */
export function Brief({
  workspaceId,
  firstName,
  units,
  canAct,
  canAsk = true,
  isOwner = false,
}: {
  workspaceId: string;
  firstName: string;
  units: "metric" | "imperial";
  canAct: boolean;
  /** False for Owners: they never see "Ask the owner" (PD v2.9). */
  canAsk?: boolean;
  /** The Owner's home leads with the decisions waiting for them, not with agronomist actions. */
  isOwner?: boolean;
}) {
  const t = useTranslations("App");
  const m = useTranslations("Main");
  const f = useTranslations("Field");
  const locale = useLocale() as "en" | "uk";
  const client = useQueryClient();
  const router = useRouter();
  const key = ["brief", workspaceId];
  useWorkspaceEvents(workspaceId, ["brief", "analysis"]);
  const brief = useQuery({ queryKey: key, queryFn: () => api<Brief>(`/api/w/${workspaceId}/brief`) });
  const decisions = useQuery({
    queryKey: ["decisions", workspaceId, "all"],
    queryFn: () => api<DecisionList>(`/api/w/${workspaceId}/decisions?state=all`),
    enabled: isOwner,
  });
  const now = useNow();
  const [done, setDone] = useState<Record<string, Done>>({});
  const [sheet, setSheet] = useState<Item | null>(null);

  if (brief.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton label={m("analyzing")} className="h-10 w-2/3" />
        <Skeleton label={m("analyzing")} className="h-80 w-full rounded-hero" />
        <Skeleton label={m("analyzing")} className="h-20 w-full" />
      </div>
    );
  }
  if (brief.isError || !brief.data) {
    return (
      <ErrorCard
        title={t("errGeneric")}
        body=""
        retryLabel={t("retry")}
        onRetry={() => void brief.refetch()}
      />
    );
  }
  const b = brief.data;
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { timeZone: "UTC", ...o }).format(
      new Date(`${iso}T12:00:00Z`),
    );
  const dateShort = (iso: string) => fmt(iso, { day: "numeric", month: "long" });
  const due = (i: Item) => {
    if (!i.deadline) return "";
    const n = Math.round((day(i.deadline) - day(b.date)) / 86_400_000);
    if (i.planning && n > 7) return t("duePlan", { date: dateShort(i.deadline) });
    return n <= 0
      ? t("dueToday")
      : n === 1
        ? t("dueTomorrow")
        : n <= 7
          ? t("dueIn", { n })
          : t("dueBy", { date: dateShort(i.deadline) });
  };
  const conf = (i: Item) => t("confLine", { conf: t(`conf_${i.confidence}`), tier: f(`tier_${i.tier}`) });
  const temp = (c: number | null) =>
    c === null ? "—" : units === "imperial" ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°`;
  const numbers = (i: Item) =>
    i.keyNumbers.slice(0, 3).map((k) => ({
      value:
        typeof k.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.value)
          ? fmt(k.value, { day: "numeric", month: "short" })
          : String(k.value),
      label: t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : k.id,
      weight: k.weight,
    }));
  const factors = (i: Item): Factor[] => {
    const source = i.evidence.find((e) => e.kind !== "citation")?.source;
    return i.keyNumbers.map((k) => ({
      label: t.has(`kn_${k.id}`) ? t(`kn_${k.id}`) : k.id,
      value: humanizeDates(`${k.value}${k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}`, dateShort),
      weight: k.weight,
      ...(source ? { source } : {}),
    }));
  };
  const hello = greetingKey(now, b.timeZone);
  const openDecisions = (decisions.data?.items ?? []).filter((d) => d.state === "waiting" || d.state === "question");

  async function act(i: Item, kind: "accept" | "snooze" | "ask", note?: string) {
    const body: AskOwnerBody = kind === "ask" && note ? { note } : {};
    const r = await api<{ undoUntil: string | null }>(
      `/api/w/${workspaceId}/recommendations/${i.id}/${kind === "ask" ? "ask-owner" : kind}`,
      { body },
    );
    if (r.undoUntil) {
      setDone((d) => ({ ...d, [i.id]: { kind, undoUntil: r.undoUntil! } }));
      setTimeout(
        () => void client.invalidateQueries({ queryKey: key }),
        new Date(r.undoUntil).getTime() - Date.now() + 300,
      );
    } else void client.invalidateQueries({ queryKey: key });
  }
  async function undo(id: string) {
    try {
      await api(`/api/w/${workspaceId}/recommendations/${id}/undo`, { body: {} });
    } finally {
      setDone((d) => {
        const { [id]: _gone, ...rest } = d;
        return rest;
      });
      void client.invalidateQueries({ queryKey: key });
    }
  }
  const doneRow = (id: string) => {
    const d = done[id];
    return d
      ? {
          label: d.kind === "accept" ? t("accDone") : d.kind === "ask" ? t("askDone") : m("snz_done"),
          undoLabel: m("undo"),
          undoUntil: d.undoUntil,
          onUndo: () => void undo(id),
        }
      : undefined;
  };

  const readOnly = isOwner || !canAct;
  const cardOf = (i: Item, primary: boolean) => (
    <TodayCard
      key={i.id}
      primary={primary}
      urgent={i.urgency === "urgent"}
      due={due(i) || (i.urgency === "urgent" ? t("groupUrgent") : t("groupWeek"))}
      fieldHref={`/fields/${i.fieldId}`}
      thumb={
        <FieldThumb
          name={i.fieldName}
          outline={i.thumb ?? null}
          crop={i.seasons.at(-1)?.crop ?? null}
          size={40}
          className="size-8"
        />
      }
      fieldName={i.fieldName + (i.more > 0 ? ` · ${t("more", { n: i.more })}` : "")}
      title={i.text.title[locale]}
      {...(i.textSource === "ai" ? { titleMark: <AiMark /> } : {})}
      action={humanizeDates(i.text.action[locale], dateShort)}
      whyText={humanizeDates(i.text.why[locale], dateShort)}
      factors={factors(i)}
      confidence={conf(i)}
      confidenceHint={
        <InfoHint label={t("hintLabel")} align="start">
          {t("hintConf")} {t(`hintTier_${i.tier}` as "hintTier_A")} {t("hintKeyNumbers")}
        </InfoHint>
      }
      labels={{
        accept: t("acceptBtn"),
        snooze: m("snooze"),
        why: t("whyBtn"),
        details: m("details"),
        ...(canAsk ? { ask: t("askBtn") } : {}),
      }}
      detailsHref={`/recommendations/${i.id}`}
      {...(readOnly
        ? {}
        : {
            onAccept: () => void act(i, "accept"),
            onSnooze: () => void act(i, "snooze"),
            ...(canAsk ? { onAsk: () => setSheet(i) } : {}),
          })}
      {...(doneRow(i.id) ? { done: doneRow(i.id)! } : {})}
    />
  );
  // Urgent first, then this week. A This-week item the API promoted to hero goes back to the week list.
  const heroUrgent = b.hero?.urgency === "urgent" ? b.hero : null;
  const urgentItems = [...b.urgent, ...(heroUrgent && !b.urgent.some((u) => u.id === heroUrgent.id) ? [heroUrgent] : [])];
  const weekItems = [...(b.hero && !heroUrgent ? [b.hero] : []), ...b.thisWeek];
  const todayCount = urgentItems.length + weekItems.length;
  const head1 = briefHeadline({ isOwner, decisions: openDecisions.length, urgent: urgentItems.length });
  const emptyText = t("emptyToday", { n: b.counts.fields });
  const summary = b.daySummary
    ? humanizeDates(b.daySummary.text[locale], dateShort)
    : todayCount === 0
      ? emptyText
      : t("daySummary", { urgent: b.counts.urgent, week: b.counts.thisWeek, fine: b.counts.allGood });
  const frosts = b.rail.weather
    .map((w) => w.nextFrost)
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, z) => a.date.localeCompare(z.date));
  const firstFrost = frosts[0];
  const frostText = firstFrost
    ? t(firstFrost.uncertain ? "frostUncertain" : "frostFrom", { date: dateShort(firstFrost.date) })
    : t("noFrost");
  const condition = (w: Brief["rail"]["weather"][number]) => {
    const d = w.today;
    if (!d) return null;
    if (d.tminC !== null && d.tminC <= 0) return { icon: <Snowflake />, text: t("wx_frost") };
    if ((d.precipMm ?? 0) >= 1) return { icon: <CloudRain />, text: t("wx_rain") };
    if (d.precipMm === null) return null;
    return { icon: <Sun />, text: t("wx_dry") };
  };
  const groupTitle = (label: string, n: number) => (
    <h3 className="text-small font-semibold tracking-wide text-ink-2 uppercase">
      {label} <span className="text-ink-3">{n}</span>
    </h3>
  );
  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-small text-ink-2">
            {t("kickerHello", {
              hello: t(hello, { name: firstName }).replace(/\.$/, ""),
              date: fmt(b.date, { weekday: "long", day: "numeric", month: "long" }),
            })}
          </p>
          <h1 className="text-h1 text-ink">
            {head1.kind === "decisions"
              ? t("headDecisions", { n: head1.n })
              : head1.kind === "urgent"
                ? t("headUrgent", { n: head1.n })
                : t("headNone")}
          </h1>
          <p className="text-body text-ink-2">
            {summary}
            {b.daySummary && <AiMark />}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <AnalysisCard workspaceId={workspaceId} timeZone={b.timeZone} canRun={canAct} />
            {canAct && (
              <Button
                variant="link"
                icon={<Plus />}
                onClick={() => router.push("/fields/new")}
                className="text-small font-semibold max-sm:hidden"
              >
                {t("addField")}
              </Button>
            )}
          </div>
          {firstFrost && (
            <p className="flex w-fit items-center gap-2 rounded-input bg-info-soft px-3 py-2 text-small text-info xl:hidden">
              <Snowflake aria-hidden className="size-4" strokeWidth={1.7} />
              {frostText}
            </p>
          )}
        </header>

        {isOwner && (
          <section aria-labelledby="owner-wait" className="rounded-hero bg-surface p-5 shadow-hero sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Gavel aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
              <h2 id="owner-wait" className="text-h2 text-ink">
                {t("ownerWaitTitle")}{" "}
                <span className="text-ink-3">{decisions.data ? openDecisions.length : ""}</span>
              </h2>
            </div>
            {openDecisions.length === 0 ? (
              <p className="text-body text-ink-2">{decisions.data ? t("ownerNone") : ""}</p>
            ) : (
              <>
                <p className="mb-3 text-body text-ink-2">{t("ownerWaitSub")}</p>
                <ul className="mb-4 flex flex-col gap-2">
                  {openDecisions.slice(0, 3).map((d) => (
                    <li key={d.id}>
                      <Link
                        href="/decisions"
                        className="focus-ring block rounded-input bg-surface-2 px-4 py-3 hover:bg-muted"
                      >
                        <span className="block text-body font-semibold text-ink">{d.title[locale]}</span>
                        <span className="block text-small text-ink-2">
                          {d.fieldName}
                          {d.deadline ? ` · ${dateShort(d.deadline)}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Button size={56} onClick={() => router.push("/decisions")} className="max-sm:w-full">
                  {t("ownerReview")}
                </Button>
              </>
            )}
          </section>
        )}

        {todayCount === 0 ? (
          <p className="rounded-card border border-line bg-surface p-5 text-body text-ink-2">{emptyText}</p>
        ) : (
          <section aria-labelledby="today-h" className="flex flex-col gap-4">
            <div>
              <h2 id="today-h" className="text-h2 text-ink">
                {isOwner ? t("ownerFarmTitle") : t("todayTitle")} <span className="text-ink-3">{todayCount}</span>
              </h2>
              {isOwner && <p className="text-small text-ink-2">{t("ownerFarmSub")}</p>}
            </div>
            {urgentItems.length > 0 && (
              <div className="flex flex-col gap-3">
                {groupTitle(t("groupUrgent"), urgentItems.length)}
                {urgentItems.map((i, n) => cardOf(i, n === 0 && !readOnly))}
              </div>
            )}
            {weekItems.length > 0 && (
              <div className="flex flex-col gap-3">
                {groupTitle(t("groupWeek"), weekItems.length)}
                {weekItems.map((i) => cardOf(i, false))}
              </div>
            )}
          </section>
        )}

        {(b.worthALook?.length ?? 0) > 0 && (
          <details className="group rounded-card border border-line bg-surface">
            <summary className="focus-ring flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 rounded-card p-4">
              <span>
                <span className="block text-h3 text-ink">
                  {t("aiWorthTitle")} <span className="text-ink-3">{b.worthALook!.length}</span>
                </span>
                <span className="block text-small text-ink-2">{t("lookHint", { n: b.worthALook!.length })}</span>
              </span>
              <ChevronDown aria-hidden className="size-5 shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-2 p-4 pt-0">
              <p className="text-small text-ink-2">{t("aiWorthSub")}</p>
              {b.worthALook!.map((i) => (
                <Link
                  key={i.id}
                  href={`/recommendations/${i.id}`}
                  className="focus-ring flex items-center gap-3 rounded-input bg-surface-2 p-3 hover:bg-muted"
                >
                  <FieldThumb
                    name={i.fieldName}
                    outline={i.thumb ?? null}
                    crop={i.seasons?.at(-1)?.crop ?? null}
                    size={40}
                    className="size-10"
                  />
                  <span className="min-w-0">
                    <span className="block text-body font-semibold text-ink">
                      {i.text.title[locale]}
                      <AiMark />
                    </span>
                    <span className="block text-small text-ink-2">{i.text.action[locale]}</span>
                    <span className="block text-small text-ink-3">{i.fieldName}</span>
                  </span>
                </Link>
              ))}
            </div>
          </details>
        )}

        {b.allGood.length > 0 && (
          <section aria-labelledby="fine-h" className="flex flex-col gap-2">
            <h2 id="fine-h" className="text-small font-semibold text-ink">
              {t("fineLine", { n: b.allGood.length })}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {b.allGood.map((g) => (
                <li key={g.fieldId}>
                  <Link
                    href={g.plan ? `/recommendations/${g.plan.id}` : `/fields/${g.fieldId}`}
                    title={g.plan ? t("fineHasPlan") : undefined}
                    className="focus-ring flex items-center gap-2 rounded-chip border border-line bg-surface py-1.5 pr-3 pl-1.5 text-small font-semibold text-ink hover:bg-muted"
                  >
                    <FieldThumb
                      name={g.name}
                      outline={g.thumb ?? null}
                      crop={g.seasons.at(-1)?.crop ?? null}
                      size={40}
                      className="size-6"
                    />
                    <span className="whitespace-nowrap">{g.name}</span>
                    {g.plan && (
                      <>
                        <CalendarClock aria-hidden className="size-4 text-ink-2" strokeWidth={1.7} />
                        <span className="sr-only">{t("fineHasPlan")}</span>
                      </>
                    )}
                    {g.unknown && <Chip tone="neutral">{t("unknownChip")}</Chip>}
                    <LandChip status={g.land} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex items-start gap-2 text-small text-ink-3">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
          {m("neutral")}
        </p>
      </div>

      <aside className="hidden flex-col gap-4 xl:flex">
        <RailCard title={t("railNext")}>
          <ul className="flex flex-col gap-3">
            {b.rail.weather.map((w) => (
              <li key={`${w.county}${w.region}`} className="flex items-start gap-2 text-small text-ink">
                <span aria-hidden className="mt-0.5 inline-flex text-ink-2 [&>svg]:size-4 [&>svg]:stroke-[1.7]">
                  {condition(w)?.icon}
                </span>
                <span className="min-w-0">
                  <span className="block">
                    {w.county}
                    {w.region ? `, ${w.region.split("-")[1]}` : ""}
                  </span>
                  <span className="block font-mono text-ink-2">
                    {w.today
                      ? `${temp(w.today.tminC)} / ${temp(w.today.tmaxC)}${condition(w) ? ` · ${condition(w)!.text}` : ""}`
                      : t("noForecast")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-2 rounded-input bg-info-soft px-3 py-2 text-small text-info">
            <Snowflake aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
            {frostText}
          </p>
          {b.rail.weather[0]?.attribution && (
            <p className="mt-2 text-micro text-ink-3 normal-case">{b.rail.weather[0].attribution}</p>
          )}
        </RailCard>
        <TodayWindows rail workspaceId={workspaceId} units={units} />
        {!isOwner && b.rail.ownerQuestion && (
          <RailCard title={m("rail_o")}>
            <p className="text-body text-ink">
              “{b.rail.ownerQuestion.text}”
              <span className="block text-small text-ink-2">
                {b.rail.ownerQuestion.fieldName} · {dateShort(b.rail.ownerQuestion.at.slice(0, 10))}
              </span>
            </p>
            <Link
              href="/decisions"
              className="focus-ring mt-4 flex min-h-tap items-center justify-center gap-2 rounded-btn bg-muted px-4 text-body font-semibold text-ink hover:brightness-95"
            >
              {t("replyLink")}
            </Link>
          </RailCard>
        )}
        <OutlookRailLine workspaceId={workspaceId} />
      </aside>
      <AskOwnerSheet
        preview={
          sheet
            ? {
                fieldName: sheet.fieldName,
                title: sheet.text.title[locale],
                action: sheet.text.action[locale],
                deadline: due(sheet),
                numbers: numbers(sheet).map((n) => ({ label: n.label, value: n.value })),
              }
            : null
        }
        onClose={() => setSheet(null)}
        onSend={(note) => {
          const i = sheet;
          setSheet(null);
          if (i) void act(i, "ask", note);
        }}
      />
    </div>
  );
}
