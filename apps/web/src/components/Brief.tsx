"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  ErrorCard,
  HeroItem,
  InfoHint,
  QueueRow,
  RailCard,
  FactorRows,
  FieldThumb,
  SeasonStrip,
  Skeleton,
  type Factor,
} from "@terrasight/ui";
import { CloudRain, Clock, MessageCircleQuestion, Plus, ShieldCheck, Snowflake, Sun } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnalysisCard } from "@/components/AnalysisCard";
import { AskOwnerSheet } from "@/components/AskOwnerSheet";
import { TodayWindows } from "@/components/TodayWindows";
import { api } from "@/lib/api";
import { useWorkspaceEvents } from "@/lib/events";
import type { AskOwnerBody } from "@terrasight/shared";
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
  urgency: "urgent" | "this_week" | "all_good";
  more: number;
  seasons: Array<{ season: number; crop: string }>;
  thumb?: string | null;
}
interface Brief {
  date: string;
  timeZone: string;
  counts: { fields: number; urgent: number; thisWeek: number; allGood: number };
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
}: {
  workspaceId: string;
  firstName: string;
  units: "metric" | "imperial";
  canAct: boolean;
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
      value: `${k.value}${k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}`,
      weight: k.weight,
      ...(source ? { source } : {}),
    }));
  };
  const strip = (s: Item["seasons"]) => (
    <SeasonStrip size="sm" seasons={s.map((x) => ({ crop: x.crop, name: x.crop, year: x.season }))} />
  );
  const hello = greetingKey(now, b.timeZone);

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

  // The hero is the first Urgent item only (design 04); a This-week item the API promoted to hero goes back to the list.
  const hero = b.hero?.urgency === "urgent" ? b.hero : null;
  const rows = [...b.urgent, ...(b.hero && !hero ? [b.hero] : []), ...b.thisWeek];
  const condition = (w: Brief["rail"]["weather"][number]) => {
    const d = w.today;
    if (!d) return null;
    if (d.tminC !== null && d.tminC <= 0) return { icon: <Snowflake />, text: t("wx_frost") };
    if ((d.precipMm ?? 0) >= 1) return { icon: <CloudRain />, text: t("wx_rain") };
    if (d.precipMm === null) return null;
    return { icon: <Sun />, text: t("wx_dry") };
  };
  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-mono text-small tracking-wide text-ink-2 uppercase max-sm:hidden">
              {t("kicker", {
                date: fmt(b.date, { weekday: "long", day: "numeric", month: "long" }),
                time: "06:00",
              })}
            </p>
            <h1 className="text-h1 text-ink">{t(hello, { name: firstName })}</h1>
            <p className="flex flex-wrap gap-2 sm:hidden">
              <Chip tone="neutral" className="font-mono">
                {t("phoneKicker", { n: b.rail.today.checked ?? 0 })}
              </Chip>
              <Chip tone="neutral" className="font-mono">
                {m("neutral")}
              </Chip>
            </p>
            <p className="text-body text-ink-2 max-sm:hidden">
              {t("daySummary", { urgent: b.counts.urgent, week: b.counts.thisWeek, fine: b.counts.allGood })}
            </p>
          </div>
          {canAct && (
            <Button
              variant="link"
              icon={<Plus />}
              onClick={() => router.push("/fields/new")}
              className="font-semibold max-sm:hidden"
            >
              {t("addField")}
            </Button>
          )}
        </header>
        {/* One Analyze fields button: beside the header on desktop, at the bottom on a phone (design 05). */}
        <div className="order-last sm:order-none">
          <AnalysisCard workspaceId={workspaceId} timeZone={b.timeZone} canRun={canAct} />
        </div>

        {hero ? (
          <HeroItem
            chip={
              <Chip tone="signal" icon={<Clock />}>
                {t("startHere")}
                {hero.deadline ? ` · ${due(hero)}` : ""}
              </Chip>
            }
            field={
              <Link
                href={`/fields/${hero.fieldId}`}
                className="flex items-center gap-3 text-small text-ink-2 hover:underline"
              >
                <FieldThumb
                  name={hero.fieldName}
                  outline={hero.thumb ?? null}
                  crop={hero.seasons.at(-1)?.crop ?? null}
                  size={40}
                />
                <span className="text-body font-semibold text-ink">{hero.fieldName}</span>
                {strip(hero.seasons)}
                {hero.more > 0 && <span>{t("more", { n: hero.more })}</span>}
              </Link>
            }
            why={<FactorRows factors={factors(hero).slice(0, 3)} />}
            title={hero.text.title[locale]}
            numbers={numbers(hero)}
            confidence={conf(hero)}
            confidenceHint={
              <InfoHint label={t("hintLabel")} align="end">
                {t("hintConf")} {t(`hintTier_${hero.tier}` as "hintTier_A")} {t("hintKeyNumbers")}
              </InfoHint>
            }
            labels={{ accept: t("acceptBtn"), snooze: m("snooze"), details: m("details"), ask: t("askBtn") }}
            detailsHref={`/recommendations/${hero.id}`}
            onAccept={() => canAct && void act(hero!, "accept")}
            onAsk={() => canAct && setSheet(hero!)}
            onSnooze={() => canAct && void act(hero!, "snooze")}
            {...(doneRow(hero.id) ? { done: doneRow(hero.id)! } : {})}
          />
        ) : (
          <p className="rounded-card border border-line bg-surface p-6 text-body text-ink-2">
            {rows.length === 0 ? t("noItems") : t("noUrgent")}
          </p>
        )}

        {(rows.length > 0 || hero) && (
          <section className="flex flex-col gap-3">
            <h2 className="text-h2 text-ink">
              {m("next_t")} <span className="text-ink-3">{rows.length}</span>
            </h2>
            {rows.length === 0 && (
              <p className="rounded-card border border-line bg-surface p-4 text-small text-ink-2">
                {t("noWeek")}
              </p>
            )}
            {rows.map((i) => (
              <QueueRow
                key={i.id}
                thumb={
                  <FieldThumb
                    name={i.fieldName}
                    outline={i.thumb ?? null}
                    crop={i.seasons.at(-1)?.crop ?? null}
                    size={56}
                    className="size-12"
                  />
                }
                title={i.text.title[locale]}
                meta={`${i.fieldName}${i.more > 0 ? ` · ${t("more", { n: i.more })}` : ""}`}
                due={due(i)}
                dueTone={i.urgency === "urgent" ? "urgent" : "week"}
                strip={strip(i.seasons)}
                factors={factors(i)}
                labels={{ why: m("why_k"), accept: t("acceptBtn"), snooze: m("snooze"), ask: t("askBtn") }}
                onAccept={() => canAct && void act(i, "accept")}
                onAsk={() => canAct && setSheet(i)}
                onSnooze={() => canAct && void act(i, "snooze")}
                {...(doneRow(i.id) ? { done: doneRow(i.id)! } : {})}
              />
            ))}
          </section>
        )}

        {b.allGood.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-h2 text-ink">
              {m("fine_t")} <span className="text-ink-3">{b.allGood.length}</span>
            </h2>
            <ul className="flex flex-wrap gap-2">
              {b.allGood.map((g) => (
                <li key={g.fieldId}>
                  <Link
                    href={g.plan ? `/recommendations/${g.plan.id}` : `/fields/${g.fieldId}`}
                    className="focus-ring flex max-w-full flex-wrap items-center gap-2 rounded-chip border border-line bg-surface px-4 py-2 text-small font-semibold text-ink hover:bg-muted"
                  >
                    <FieldThumb
                      name={g.name}
                      outline={g.thumb ?? null}
                      crop={g.seasons.at(-1)?.crop ?? null}
                      size={40}
                      className="size-6"
                    />
                    <span className="whitespace-nowrap">{g.name}</span>
                    <SeasonStrip
                      size="sm"
                      seasons={g.seasons.map((x) => ({ crop: x.crop, name: x.crop, year: x.season }))}
                    />
                    {g.plan && (
                      <Chip tone="signal" className="max-w-full truncate">
                        {t("planChip", {
                          title: g.plan.title[locale],
                          date: g.plan.deadline ? dateShort(g.plan.deadline) : "—",
                        })}
                      </Chip>
                    )}
                    {g.unknown && <Chip tone="neutral">{t("unknownChip")}</Chip>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex items-center gap-2 text-small text-ink-3 max-sm:hidden">
          <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
          {m("neutral")}
        </p>
      </div>

      <aside className="hidden flex-col gap-4 md:flex">
        <RailCard title={m("rail_day")}>
          <div className="grid grid-cols-3 gap-2">
            <p className="rounded-input bg-signal p-3 text-on-signal">
              <span className="block font-mono text-h2">{b.counts.urgent}</span>
              <span className="text-small">{m("d1")}</span>
            </p>
            <p className="rounded-input bg-week-soft p-3 text-week">
              <span className="block font-mono text-h2">{b.counts.thisWeek}</span>
              <span className="text-small">{m("d2")}</span>
            </p>
            <p className="rounded-input bg-muted p-3 text-ink">
              <span className="block font-mono text-h2">{b.rail.today.checked ?? "—"}</span>
              <span className="text-small">{m("d3")}</span>
            </p>
          </div>
        </RailCard>
        <RailCard title={m("rail_w")}>
          <ul className="flex flex-col gap-2">
            {b.rail.weather.map((w) => (
              <li key={`${w.county}${w.region}`} className="flex justify-between gap-3 text-small text-ink">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-flex text-ink-2 [&>svg]:size-4 [&>svg]:stroke-[1.7]">
                    {condition(w)?.icon}
                  </span>
                  {w.county}
                  {w.region ? `, ${w.region.split("-")[1]}` : ""}
                </span>
                <span className="font-mono text-ink-2">
                  {w.today
                    ? `${temp(w.today.tminC)} / ${temp(w.today.tmaxC)}${condition(w) ? ` · ${condition(w)!.text}` : ""}`
                    : t("noForecast")}
                </span>
              </li>
            ))}
          </ul>
          {(() => {
            const frosts = b.rail.weather
              .map((w) => w.nextFrost)
              .filter((x): x is NonNullable<typeof x> => x !== null)
              .sort((a, z) => a.date.localeCompare(z.date));
            const first = frosts[0];
            return (
              <p className="mt-3 flex items-center gap-2 rounded-input bg-info-soft px-3 py-2 text-small text-info">
                <Snowflake aria-hidden className="size-4" strokeWidth={1.7} />
                {first
                  ? t(first.uncertain ? "frostUncertain" : "frostFrom", { date: dateShort(first.date) })
                  : t("noFrost")}
              </p>
            );
          })()}
          {b.rail.weather[0]?.attribution && (
            <p className="mt-2 text-micro text-ink-3">{b.rail.weather[0].attribution}</p>
          )}
        </RailCard>
        <TodayWindows rail workspaceId={workspaceId} units={units} />
        <RailCard title={m("rail_o")}>
          {b.rail.ownerQuestion ? (
            <p className="flex gap-2 text-body text-ink">
              <MessageCircleQuestion aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={1.7} />
              <span>
                “{b.rail.ownerQuestion.text}”
                <span className="block text-small text-ink-2">
                  {b.rail.ownerQuestion.fieldName} · {dateShort(b.rail.ownerQuestion.at.slice(0, 10))}
                </span>
              </span>
            </p>
          ) : (
            <p className="text-small text-ink-2">{t("noQuestion")}</p>
          )}
          {b.rail.ownerQuestion && (
            <Link
              href="/decisions"
              className="focus-ring mt-4 flex min-h-tap items-center justify-center gap-2 rounded-btn bg-muted px-4 text-body font-semibold text-ink hover:brightness-95"
            >
              {t("replyLink")}
            </Link>
          )}
        </RailCard>
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
