"use client";

import { LandChip } from "@/components/LandSuitability";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  Disclosure,
  FieldThumb,
  Kicker,
  Skeleton,
  Surface,
  type Factor,
} from "@terrasight/ui";
import { CalendarClock, CloudRain, Gavel, ShieldCheck, Snowflake, Sun } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnalysisCard } from "@/components/AnalysisCard";
import { AiMark } from "@/components/AiMark";
import { AskOwnerSheet } from "@/components/AskOwnerSheet";
import { FarmStressLine } from "@/components/FarmStressLine";
import { OutlookRailLine } from "@/components/OutlookRailLine";
import { QueryState } from "@/components/QueryState";
import { SuggestionChips, type SuggestedQuestion } from "@/components/SuggestionChips";
import { TrustLine } from "@/components/TrustLine";
import type { FieldsOverviewData } from "@/app/fields/FieldsOverview";
import { TodayCard, TodayRow } from "@/components/TodayCard";
import { TodayWindows } from "@/components/TodayWindows";
import { api, ApiError } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import type { AskOwnerBody, DecisionList, FarmStress } from "@terrasight/shared";
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
type DynamicT = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

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
  const mk = m as unknown as DynamicT;
  const locale = useLocale() as "en" | "uk";
  const fmt = useFormat({ units });
  const fmtMetric = useFormat({ units: "metric" });
  const fmtImperial = useFormat({ units: "imperial" });
  /** Units follow the field's country (US: imperial), not the company setting; unknown country: the company setting. */
  const fmtFor = (country: string | null | undefined) =>
    !country ? fmt : country.toUpperCase() === "US" ? fmtImperial : fmtMetric;
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
  // Independent of the brief: it never blocks or delays it. A 404 (API not deployed yet) means "unavailable".
  const stress = useQuery({
    queryKey: ["brief", workspaceId, "farm-stress"],
    queryFn: async (): Promise<FarmStress> => {
      try {
        return await api<FarmStress>(`/api/w/${workspaceId}/farm-stress`);
      } catch (e) {
        if (e instanceof ApiError && e.problem.status === 404)
          return {
            status: "unavailable",
            stressYear: 2022,
            season: new Date().getFullYear(),
            currency: null,
            current: null,
            recommended: null,
            difference: null,
            counted: [],
            notCounted: [],
          };
        throw e;
      }
    },
  });
  // Which country each field is in: the same cached query as the Fields page.
  const fieldCountries = useQuery({
    queryKey: ["fields-overview", workspaceId],
    queryFn: () => api<FieldsOverviewData>(`/api/w/${workspaceId}/fields-overview`),
    staleTime: 30_000,
    select: (d) =>
      new Map(d.counties.flatMap((c) => c.fields.map((row) => [row.fieldId, c.state?.split("-")[0] ?? null] as const))),
  });
  const now = useNow();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
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

  if (!brief.data) {
    return (
      <QueryState
        query={brief}
        what={t("todayTitle")}
        still={m("t_still")}
        skeleton={
          <div className="flex flex-col gap-6" aria-busy>
            <Skeleton label={t("loading")} variant="text" rows={2} className="w-2/3" />
            <Skeleton label={t("loading")} variant="number" />
            <Skeleton label={t("loading")} variant="rows" rows={3} />
          </div>
        }
      >
        {() => null}
      </QueryState>
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
  const nowMs = Date.parse(`${b.date}T12:00:00Z`);
  /** The one date rule for "when": today / tomorrow as words, any other day short. */
  const relDate = (iso: string) => fmt.dateRel(`${iso}T12:00:00Z`, { now: nowMs, style: "dayMonth", timeZone: "UTC" });
  const keyFmtFor = (fieldId: string) => {
    const x = fmtFor(fieldCountries.data?.get(fieldId));
    return {
      date: dateShort,
      number: (n: number) => x.number(n),
      percent: (v: number) => x.percent(v),
      temp: (c: number) => x.temp(c),
      rain: (mm: number) => x.rain(mm),
      money: (a: number, c: "USD" | "UAH") => x.money(a, c),
    };
  };
  /** Key numbers with their unit-aware label; an id without a label or a value that does not fit is dropped. */
  const shownNumbers = (i: Item) =>
    i.keyNumbers.flatMap((k) => {
      const value = formatKeyNumber(k, keyFmtFor(i.fieldId));
      return value !== null && mk.has(`kn_${k.id}`)
        ? [{ value, label: mk(`kn_${k.id}`), weight: k.weight }]
        : [];
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
  const openDecisions = (decisions.data?.items ?? []).filter(
    (d) => d.state === "waiting" || d.state === "question",
  );

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
      toast.fail(
        e,
        kind === "accept" ? t("acceptBtn") : kind === "snooze" ? m("snooze") : t("askBtn"),
        () => void act(i, kind, note),
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
  const urgentItems = [
    ...b.urgent,
    ...(heroUrgent && !b.urgent.some((u) => u.id === heroUrgent.id) ? [heroUrgent] : []),
  ];
  const weekItems = [...(b.hero && !heroUrgent ? [b.hero] : []), ...b.thisWeek];
  const ordered = [...urgentItems, ...weekItems];
  // The agronomist's first card is the headline recommendation; the Owner reads one flat list (collapsed).
  const headline = readOnly ? null : (ordered[0] ?? null);
  const rest = headline ? ordered.slice(1) : ordered;
  // H1 = the things that cannot wait (the headline card plus "Also today"); "Also this week" is the rest of the week.
  const alsoToday = rest.filter((i) => i.urgency === "urgent");
  const alsoWeek = rest.filter((i) => i.urgency !== "urgent");
  const head1 = briefHeadline({ isOwner, decisions: openDecisions.length, urgent: urgentItems.length });
  const emptyText = t("emptyToday", { n: b.counts.fields });
  // The day summary only when it adds something (more than one thing to read); never for the Owner.
  const summary =
    !isOwner && b.daySummary && ordered.length > 1 ? humanizeDates(b.daySummary.text[locale], dateShort) : null;

  // One source for the frost date: formatted with dateRel; dropped when the headline card is itself a frost item.
  const heroIsFrost = !!headline?.keyNumbers.some((k) => ["frostMinC", "daysUntilFrost", "frostDate"].includes(k.id));
  const frosts = b.rail.weather
    .flatMap((w) => (w.nextFrost ? [{ ...w.nextFrost, place: w.county }] : []))
    .sort((a, z) => a.date.localeCompare(z.date));
  const firstFrost = frosts[0];
  const frostText = firstFrost
    ? mk("t_frost_where", { date: relDate(firstFrost.date), place: firstFrost.place })
    : t("noFrost");
  const condition = (w: Brief["rail"]["weather"][number]) => {
    const d = w.today;
    if (!d) return null;
    if (d.tminC !== null && d.tminC <= 0) return { icon: <Snowflake />, text: t("wx_frost") };
    if ((d.precipMm ?? 0) >= 1) return { icon: <CloudRain />, text: t("wx_rain") };
    if (d.precipMm === null) return null;
    return { icon: <Sun />, text: t("wx_dry") };
  };
  const wxFmt = (w: Brief["rail"]["weather"][number]) => fmtFor(w.region?.split("-")[0]);
  const temp = (w: Brief["rail"]["weather"][number], c: number | null) => (c === null ? "—" : wxFmt(w).temp(c));

  const questions = isOwner
    ? [
        { id: "o1", text: m("t_q_owner1") },
        { id: "o2", text: m("t_q_owner2") },
      ]
    : [
        { id: "q1", text: m("t_q_first") },
        { id: "q2", text: m("t_q_risk") },
        { id: "q3", text: m("t_q_spray") },
      ];
  // The assistant fills the composer with the question and does not send it (the /assistant?ask contract).
  const askAssistant = (q: SuggestedQuestion, fieldId?: string) =>
    router.push(`/assistant?ask=${encodeURIComponent(q.text)}${fieldId ? `&field=${encodeURIComponent(fieldId)}` : ""}`);

  const ownerSection = isOwner && (
    <Surface as="section" tone="hero" pad="md" aria-labelledby="owner-wait" className="animate-rise sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Gavel aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
        <h2 id="owner-wait" className="text-h2 text-ink">
          {t("ownerWaitTitle")}
        </h2>
      </div>
      <QueryState
        query={decisions}
        skeletonVariant="rows"
        what={t("ownerWaitTitle")}
        still={m("t_still")}
      >
        {() =>
          openDecisions.length === 0 ? (
            <p className="text-body text-ink-2">{t("ownerNone")}</p>
          ) : (
            <>
              <p className="mb-3 text-body text-ink-2">{m("t_owner_ask_decision")}</p>
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
                        {d.deadline ? ` · ${m("t_owner_answer_by", { date: relDate(d.deadline) })}` : ""}
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

  const stressLine =
    b.counts.fields > 0 ? (
      <FarmStressLine
        data={stress.data}
        isLoading={stress.isLoading}
        isError={stress.isError}
        onRetry={() => void stress.refetch()}
        units={units}
      />
    ) : null;

  const weatherRows = b.rail.weather.slice(0, 2);
  const firstWx = weatherRows[0];
  const next7Note = firstWx?.today
    ? mk("t_next7_sum", {
        place: firstWx.county,
        range: `${temp(firstWx, firstWx.today.tminC)} / ${temp(firstWx, firstWx.today.tmaxC)}${condition(firstWx) ? ` · ${condition(firstWx)!.text}` : ""}`,
      })
    : undefined;
  const nextDays = (
    <Surface as="section" pad="sm" aria-labelledby="next7-h">
      <Disclosure
        summary={<span id="next7-h">{m("next7_title")}</span>}
        {...(next7Note ? { summaryNote: next7Note } : {})}
      >
        <div className="flex flex-col gap-3 pt-2">
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
                        ? `${temp(w, w.today.tminC)} / ${temp(w, w.today.tmaxC)}${condition(w) ? ` · ${condition(w)!.text}` : ""}`
                        : t("noForecast")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!(heroIsFrost && firstFrost) && (
            <p className="flex items-center gap-2 rounded-input bg-info-soft px-3 py-2 text-caption text-info">
              <Snowflake aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
              {frostText}
            </p>
          )}
          <TodayWindows bare workspaceId={workspaceId} units={units} />
          <OutlookRailLine workspaceId={workspaceId} className="" />
          {b.rail.weather[0]?.attribution && (
            <p className="text-caption text-ink-3">{b.rail.weather[0].attribution}</p>
          )}
          <Link
            href="/work-windows"
            className="focus-ring inline-flex min-h-tap items-center text-caption font-semibold text-ink underline underline-offset-4"
          >
            {m("next7_link")}
          </Link>
        </div>
      </Disclosure>
    </Surface>
  );

  const rowsOf = (items: Item[], idOffset = 0) => (
    <ul className="flex flex-col gap-3">
      {items.map((i, n) => (
        <li key={i.id}>
          <TodayRow
            urgent={i.urgency === "urgent"}
            status={i.urgency === "urgent" ? t("groupUrgent") : t("groupWeek")}
            due={due(i) || (i.urgency === "urgent" ? t("groupUrgent") : t("groupWeek"))}
            fieldName={fieldLabel(i)}
            title={i.text.title[locale]}
            {...(i.textSource === "ai" ? { titleMark: <AiMark /> } : {})}
            href={`/recommendations/${i.id}`}
            thumb={thumbOf(i, "size-10")}
            index={n + idOffset}
            flash={flash.has(i.id)}
            {...(doneRow(i.id) ? { done: doneRow(i.id)! } : {})}
          />
        </li>
      ))}
    </ul>
  );
  /** A queue section: open, at most five rows, then "Show all N". */
  const queue = (id: string, title: string, items: Item[], idOffset = 0) =>
    items.length > 0 && (
      <section aria-labelledby={id} className="flex flex-col gap-3">
        <h2 id={id} className="text-h2 text-ink">
          {title} <span className="text-ink-3">{items.length}</span>
        </h2>
        {rowsOf(showAll[id] ? items : items.slice(0, 5), idOffset)}
        {items.length > 5 && !showAll[id] && (
          <div>
            <Button variant="link" className="min-h-tap" onClick={() => setShowAll((s) => ({ ...s, [id]: true }))}>
              {m("t_show_all", { n: items.length })}
            </Button>
          </div>
        )}
      </section>
    );

  const allFine = b.allGood.length > 0 && (
    <Surface pad="sm">
      <Disclosure summary={<span className="text-body font-semibold text-ink">{m("t_fine", { n: b.allGood.length })}</span>}>
        <section aria-label={m("t_fine", { n: b.allGood.length })} className="pt-2">
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
      </Disclosure>
    </Surface>
  );

  const ideas = !isOwner && (b.worthALook?.length ?? 0) > 0 && (
    <Surface pad="sm">
      <Disclosure
        summary={
          <span className="text-body font-semibold text-ink">
            {m("t_ideas")} <span className="text-ink-3">{b.worthALook!.length}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-caption text-ink-2">{m("t_ideas_sub")}</p>
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
  );

  const h1 =
    head1.kind === "decisions"
      ? m("t_h1_owner", { n: head1.n })
      : head1.kind === "urgent"
        ? m("t_h1", { n: head1.n })
        : isOwner
          ? m("t_h1_clear")
          : m("t_h1_none");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Kicker>
          {t("kickerHello", {
            hello: t(hello, { name: firstName }).replace(/\.$/, ""),
            date: fmt.date(`${b.date}T12:00:00Z`, "dayMonth", { timeZone: "UTC" }),
          })}
        </Kicker>
        <h1 className="text-h1 text-ink">{h1}</h1>
        {summary && (
          <p className="text-body text-ink-2">
            {summary}
            <AiMark />
          </p>
        )}
        {!isOwner && (
          <AnalysisCard
            workspaceId={workspaceId}
            timeZone={b.timeZone}
            canRun={canAct}
            fieldsTotal={b.counts.fields}
          />
        )}
      </header>

      {ownerSection}

      {isOwner && stressLine}

      {!isOwner && b.rail.ownerQuestion && (
        <Surface
          as="section"
          tone="inset"
          pad="sm"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="min-w-0 text-body text-ink">
            <span className="font-semibold">{m("t_owner_asked")}:</span> “{b.rail.ownerQuestion.text}”
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
          trust={
            <TrustLine
              reliability={headline.confidence}
              dataLevel={headline.tier}
              sources={[...new Set(headline.evidence.flatMap((e) => (e.source ? [e.source] : [])))]}
            />
          }
          startLabel={m("start_this")}
          moreLabel={m("more_actions")}
          labels={{
            accept: t("acceptBtn"),
            snooze: m("snooze"),
            why: m("t_evidence"),
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

      {!isOwner && ordered.length === 0 && (
        <Surface pad="md">
          <p className="text-body text-ink-2">{emptyText}</p>
        </Surface>
      )}

      {!isOwner && (
        <SuggestionChips
          questions={questions}
          onAsk={(q) => askAssistant(q, headline?.fieldId)}
          className="-mt-2"
        />
      )}

      {!isOwner && queue("also-today", m("t_also_today"), alsoToday)}
      {!isOwner && queue("also-week", m("t_also_week"), alsoWeek, alsoToday.length)}

      {isOwner && (
        <SuggestionChips questions={questions} onAsk={(q) => askAssistant(q)} className="-mt-2" />
      )}

      {isOwner && ordered.length > 0 && (
        <Surface pad="sm">
          <Disclosure
            summary={
              <span className="text-body font-semibold text-ink">
                {m("t_owner_work")} <span className="text-ink-3">{ordered.length}</span>
              </span>
            }
          >
            <div className="pt-2">{rowsOf(ordered)}</div>
          </Disclosure>
        </Surface>
      )}

      {!isOwner && nextDays}

      {!isOwner && stressLine}

      {allFine}

      {ideas}

      <p className="flex items-start gap-2 text-caption text-ink-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
        {m("t_neutral")}
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
