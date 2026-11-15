"use client";

import { LandChip } from "@/components/LandSuitability";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  Disclosure,
  ErrorCard,
  FieldThumb,
  InfoHint,
  Kicker,
  Skeleton,
  Surface,
  type Factor,
} from "@terrasight/ui";
import { CalendarClock, CloudRain, Gavel, Plus, ShieldCheck, Snowflake, Sun } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnalysisCard } from "@/components/AnalysisCard";
import { AiMark } from "@/components/AiMark";
import { AskOwnerSheet } from "@/components/AskOwnerSheet";
import { OutlookRailLine } from "@/components/OutlookRailLine";
import { QueryState } from "@/components/QueryState";
import { TodayCard, TodayRow } from "@/components/TodayCard";
import { TodayWindows } from "@/components/TodayWindows";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import type { AskOwnerBody, DecisionList } from "@terrasight/shared";
import { briefHeadline, formatKeyNumber, humanizeDates } from "@/lib/brief";
import { greetingKey, useNow } from "@/lib/time";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

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

/** Message lookup with a `has` check, for keys built at run time (`kn_<id>`). */
type DynamicT = { (key: string, values?: Record<string, string | number>): string; has: (key: string) => boolean };

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
  const mk = m as unknown as DynamicT;
  const locale = useLocale() as "en" | "uk";
  const fmt = useFormat({ units });
  const client = useQueryClient();
  const router = useRouter();
  const toast = useActionToast();
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

  // A row that changed since the previous refresh flashes once. Nothing flashes on the first load.
  const seen = useRef<Map<string, string> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const data = brief.data;
  useEffect(() => {
    if (!data) return;
    const items = [...data.urgent, ...data.thisWeek, ...(data.hero ? [data.hero] : [])];
    const cur = new Map(items.map((i) => [i.id, `${i.urgency}|${i.text.title.en}|${i.deadline ?? ""}`]));
    if (seen.current) {
      const prev = seen.current;
      const changed = [...cur].filter(([id, v]) => prev.get(id) !== v).map(([id]) => id);
      if (changed.length > 0) setFlash(new Set(changed));
    }
    seen.current = cur;
  }, [data]);

  if (brief.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton label={t("loading")} variant="text" rows={2} className="w-2/3" />
        <Skeleton label={t("loading")} variant="number" />
        <Skeleton label={t("loading")} variant="rows" rows={3} />
      </div>
    );
  }
  if (brief.isError || !brief.data) {
    return (
      <ErrorCard
        title={t("qsErrWhat", { what: t("todayTitle") })}
        body={t("qsErrBody")}
        retryLabel={t("retry")}
        onRetry={() => void brief.refetch()}
      />
    );
  }
  const b = brief.data;
  const dateShort = (iso: string) => fmt.date(`${iso}T12:00:00Z`, "dayMonth", { timeZone: "UTC" });
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
  const reliability = (i: Item) =>
    m("rel_line", { conf: t(`conf_${i.confidence}`), tier: f(`tier_${i.tier}`) });
  const keyFmt = {
    date: dateShort,
    number: (n: number) => fmt.number(n),
    percent: (x: number) => fmt.percent(x),
    temp: (c: number) => fmt.temp(c),
    rain: (mm: number) => fmt.rain(mm),
    money: (a: number, c: "USD" | "UAH") => fmt.money(a, c),
  };
  /** Key numbers with their unit-aware label; an id without a label or a value that does not fit is dropped. */
  const shownNumbers = (i: Item) =>
    i.keyNumbers.flatMap((k) => {
      const value = formatKeyNumber(k, keyFmt);
      return value !== null && mk.has(`kn_${k.id}`) ? [{ value, label: mk(`kn_${k.id}`), weight: k.weight }] : [];
    });
  const factors = (i: Item): Factor[] => {
    const source = i.evidence.find((e) => e.kind !== "citation")?.source;
    return shownNumbers(i).map((k) => ({
      label: k.label,
      value: k.value,
      weight: k.weight,
      ...(source ? { source } : {}),
    }));
  };
  const hello = greetingKey(now, b.timeZone);
  const openDecisions = (decisions.data?.items ?? []).filter((d) => d.state === "waiting" || d.state === "question");

  async function act(i: Item, kind: "accept" | "snooze" | "ask", note?: string) {
    const body: AskOwnerBody = kind === "ask" && note ? { note } : {};
    try {
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
    } catch (e) {
      toast.fail(e, kind === "accept" ? t("acceptBtn") : kind === "snooze" ? m("snooze") : t("askBtn"), () =>
        void act(i, kind, note),
      );
    }
  }
  async function undo(id: string) {
    try {
      await api(`/api/w/${workspaceId}/recommendations/${id}/undo`, { body: {} });
      setDone((d) => {
        const { [id]: _gone, ...rest } = d;
        return rest;
      });
    } catch (e) {
      toast.fail(e, m("undo"), () => void undo(id));
    } finally {
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
  const thumbOf = (i: Item, size: string) => (
    <FieldThumb
      name={i.fieldName}
      outline={i.thumb ?? null}
      crop={i.seasons?.at(-1)?.crop ?? null}
      size={40}
      className={size}
    />
  );
  const fieldLabel = (i: Item) => i.fieldName + (i.more > 0 ? ` · ${t("more", { n: i.more })}` : "");
  // Urgent first, then this week. A This-week item the API promoted to hero goes back to the week list.
  const heroUrgent = b.hero?.urgency === "urgent" ? b.hero : null;
  const urgentItems = [...b.urgent, ...(heroUrgent && !b.urgent.some((u) => u.id === heroUrgent.id) ? [heroUrgent] : [])];
  const weekItems = [...(b.hero && !heroUrgent ? [b.hero] : []), ...b.thisWeek];
  const ordered = [...urgentItems, ...weekItems];
  const todayCount = ordered.length;
  // The agronomist's first card is the headline recommendation; the Owner reads one flat list.
  const headline = readOnly ? null : (ordered[0] ?? null);
  const rest = headline ? ordered.slice(1) : ordered;
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
  const temp = (c: number | null) => (c === null ? "—" : fmt.temp(c));

  const ownerSection = isOwner && (
    <Surface as="section" tone="hero" pad="md" aria-labelledby="owner-wait" className="animate-rise sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Gavel aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
        <h2 id="owner-wait" className="text-h2 text-ink">
          {t("ownerWaitTitle")} {decisions.data && <span className="text-ink-3">{openDecisions.length}</span>}
        </h2>
      </div>
      <QueryState query={decisions} skeletonVariant="rows" what={t("ownerWaitTitle")}>
        {() =>
          openDecisions.length === 0 ? (
            <p className="text-body text-ink-2">{t("ownerNone")}</p>
          ) : (
            <>
              <p className="mb-3 text-body text-ink-2">{t("ownerWaitSub")}</p>
              <ul className="mb-4 flex flex-col gap-2">
                {openDecisions.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    <Link
                      href="/decisions"
                      className="focus-ring block min-h-tap rounded-input bg-surface-2 px-4 py-3 hover:bg-muted"
                    >
                      <span className="block text-body font-semibold text-ink">{d.title[locale]}</span>
                      <span className="block text-caption text-ink-2">
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
          )
        }
      </QueryState>
    </Surface>
  );

  const weatherRows = b.rail.weather.slice(0, 2);
  const nextDays = (
    <Surface as="section" aria-labelledby="next7-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Kicker as="h2" className="" >
          <span id="next7-h">{m("next7_title")}</span>
        </Kicker>
        <Link
          href="/work-windows"
          className="focus-ring inline-flex min-h-tap items-center text-caption font-semibold text-ink underline underline-offset-4"
        >
          {m("next7_link")}
        </Link>
      </div>
      {weatherRows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {weatherRows.map((w) => (
            <li key={`${w.county}${w.region}`} className="flex items-start gap-2 text-caption text-ink">
              <span aria-hidden className="mt-0.5 inline-flex text-ink-2 [&>svg]:size-4 [&>svg]:stroke-[1.7]">
                {condition(w)?.icon}
              </span>
              <span className="min-w-0">
                {w.county}
                {w.region ? `, ${w.region.split("-")[1]}` : ""}
                <span className="block font-mono text-ink-2">
                  {w.today
                    ? `${temp(w.today.tminC)} / ${temp(w.today.tmaxC)}${condition(w) ? ` · ${condition(w)!.text}` : ""}`
                    : t("noForecast")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-2 rounded-input bg-info-soft px-3 py-2 text-caption text-info">
        <Snowflake aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
        {frostText}
      </p>
      <TodayWindows bare workspaceId={workspaceId} units={units} />
      <OutlookRailLine workspaceId={workspaceId} className="" />
      {b.rail.weather[0]?.attribution && <p className="text-caption text-ink-3">{b.rail.weather[0].attribution}</p>}
    </Surface>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Kicker>
          {t("kickerHello", {
            hello: t(hello, { name: firstName }).replace(/\.$/, ""),
            date: fmt.date(`${b.date}T12:00:00Z`, "dayMonth", { timeZone: "UTC" }),
          })}
        </Kicker>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <AnalysisCard workspaceId={workspaceId} timeZone={b.timeZone} canRun={canAct && !isOwner} />
          {canAct && !isOwner && (
            <Button
              variant="link"
              icon={<Plus />}
              onClick={() => router.push("/fields/new")}
              className="text-caption font-semibold max-sm:hidden"
            >
              {t("addField")}
            </Button>
          )}
        </div>
      </header>

      {ownerSection}

      {!isOwner && b.rail.ownerQuestion && (
        <Surface as="section" tone="inset" pad="sm" className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-body text-ink">
            <Kicker as="span" className="block">
              {m("rail_o")}
            </Kicker>
            “{b.rail.ownerQuestion.text}”
            <span className="block text-caption text-ink-2">
              {b.rail.ownerQuestion.fieldName} · {dateShort(b.rail.ownerQuestion.at.slice(0, 10))}
            </span>
          </p>
          <Link
            href="/decisions"
            className="focus-ring inline-flex min-h-tap items-center rounded-btn bg-muted px-4 text-body font-semibold text-ink hover:brightness-95"
          >
            {t("replyLink")}
          </Link>
        </Surface>
      )}

      {headline && (
        <TodayCard
          urgent={headline.urgency === "urgent"}
          due={due(headline) || (headline.urgency === "urgent" ? t("groupUrgent") : t("groupWeek"))}
          fieldHref={`/fields/${headline.fieldId}`}
          thumb={thumbOf(headline, "size-8")}
          fieldName={fieldLabel(headline)}
          title={headline.text.title[locale]}
          {...(headline.textSource === "ai" ? { titleMark: <AiMark /> } : {})}
          action={humanizeDates(headline.text.action[locale], dateShort)}
          whyText={humanizeDates(headline.text.why[locale], dateShort)}
          factors={factors(headline)}
          numbers={shownNumbers(headline).slice(0, 3)}
          reliability={reliability(headline)}
          reliabilityHint={
            <InfoHint label={t("hintLabel")} align="start">
              {t("hintConf")} {t(`hintTier_${headline.tier}` as "hintTier_A")} {t("hintKeyNumbers")}
            </InfoHint>
          }
          startLabel={m("start_this")}
          moreLabel={m("more_actions")}
          labels={{
            accept: t("acceptBtn"),
            snooze: m("snooze"),
            why: t("whyBtn"),
            details: m("details"),
            ...(canAsk ? { ask: t("askBtn") } : {}),
          }}
          detailsHref={`/recommendations/${headline.id}`}
          onAccept={() => void act(headline, "accept")}
          onSnooze={() => void act(headline, "snooze")}
          {...(canAsk ? { onAsk: () => setSheet(headline) } : {})}
          {...(doneRow(headline.id) ? { done: doneRow(headline.id)! } : {})}
        />
      )}

      {todayCount === 0 ? (
        <Surface pad="md">
          <p className="text-body text-ink-2">{emptyText}</p>
        </Surface>
      ) : (
        rest.length > 0 && (
          <section aria-labelledby="today-h" className="flex flex-col gap-3">
            <div>
              <h2 id="today-h" className="text-h2 text-ink">
                {isOwner ? t("ownerFarmTitle") : t("todayTitle")} <span className="text-ink-3">{todayCount}</span>
              </h2>
              {isOwner && <p className="text-caption text-ink-2">{t("ownerFarmSub")}</p>}
            </div>
            <ul className="flex flex-col gap-3">
              {rest.map((i, n) => (
                <li key={i.id}>
                  <TodayRow
                    urgent={i.urgency === "urgent"}
                    status={i.urgency === "urgent" ? t("groupUrgent") : t("groupWeek")}
                    due={due(i) || (i.urgency === "urgent" ? t("groupUrgent") : t("groupWeek"))}
                    fieldName={fieldLabel(i)}
                    title={i.text.title[locale]}
                    {...(i.textSource === "ai" ? { titleMark: <AiMark /> } : {})}
                    reason={humanizeDates(i.text.why[locale] || i.text.action[locale], dateShort)}
                    href={`/recommendations/${i.id}`}
                    thumb={thumbOf(i, "size-10")}
                    index={n}
                    flash={flash.has(i.id)}
                    {...(doneRow(i.id) ? { done: doneRow(i.id)! } : {})}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {nextDays}

      {(b.worthALook?.length ?? 0) > 0 && (
        <Surface pad="sm">
          <Disclosure
            summary={
              <>
                <span className="block text-h3 text-ink">
                  {t("aiWorthTitle")} <span className="text-ink-3">{b.worthALook!.length}</span>
                </span>
                <span className="block text-caption font-normal text-ink-2">
                  {t("lookHint", { n: b.worthALook!.length })}
                </span>
              </>
            }
          >
            <div className="flex flex-col gap-2 pt-2">
              <p className="text-caption text-ink-2">{t("aiWorthSub")}</p>
              {b.worthALook!.map((i) => (
                <Link
                  key={i.id}
                  href={`/recommendations/${i.id}`}
                  className="focus-ring flex min-h-tap items-center gap-3 rounded-input bg-surface-2 p-3 hover:bg-muted"
                >
                  {thumbOf(i, "size-10")}
                  <span className="min-w-0">
                    <span className="block text-body font-semibold text-ink">
                      {i.text.title[locale]}
                      <AiMark />
                    </span>
                    <span className="block text-caption text-ink-2">{i.text.action[locale]}</span>
                    <span className="block text-caption text-ink-3">{i.fieldName}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Disclosure>
        </Surface>
      )}

      {b.allGood.length > 0 && (
        <section aria-labelledby="fine-h" className="flex flex-col gap-2">
          <h2 id="fine-h" className="text-caption font-semibold text-ink">
            {t("fineLine", { n: b.allGood.length })}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {b.allGood.map((g) => (
              <li key={g.fieldId}>
                <Link
                  href={g.plan ? `/recommendations/${g.plan.id}` : `/fields/${g.fieldId}`}
                  title={g.plan ? t("fineHasPlan") : undefined}
                  className="focus-ring flex min-h-tap items-center gap-2 rounded-chip border border-line bg-surface py-1.5 pr-3 pl-1.5 text-caption font-semibold text-ink hover:bg-muted"
                >
                  <FieldThumb
                    name={g.name}
                    outline={g.thumb ?? null}
                    crop={g.seasons?.at(-1)?.crop ?? null}
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

      <p className="flex items-start gap-2 text-caption text-ink-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
        {m("neutral")}
      </p>

      <AskOwnerSheet
        preview={
          sheet
            ? {
                fieldName: sheet.fieldName,
                title: sheet.text.title[locale],
                action: sheet.text.action[locale],
                deadline: due(sheet),
                numbers: shownNumbers(sheet).map((n) => ({ label: n.label, value: n.value })),
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
