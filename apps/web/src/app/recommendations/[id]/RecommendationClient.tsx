"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  cropColour,
  Disclosure,
  DoneRow,
  FactorRows,
  InfoHint,
  Kicker,
  Menu,
  Surface,
  type Factor,
  type MenuItem,
} from "@terrasight/ui";
import {
  ArrowLeft,
  Bug,
  Calendar,
  Check,
  Eye,
  MessageCircleQuestion,
  Clock,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AiMark } from "@/components/AiMark";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { AskOwnerBody } from "@terrasight/shared";
import { AskOwnerSheet } from "@/components/AskOwnerSheet";
import { api } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

type Localised = { en: string; uk: string };
export interface RecView {
  id: string;
  fieldId: string;
  fieldName: string;
  type: "pest" | "disease" | "rotation" | "irrigation" | "sowing" | "weather";
  subject: string;
  season: number;
  status: "open" | "accepted" | "snoozed" | "in_report" | "dismissed" | "expired" | "superseded";
  level: "high" | "moderate" | "low" | "none" | "unknown";
  confidence: "high" | "medium" | "low";
  tier: "A" | "B" | "C";
  deadline: string | null;
  planning: boolean;
  irreversible: boolean;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string; weight: number }>;
  drivers: Array<{ driver: string; value: number | string; unit?: string; fired: boolean }>;
  evidence: Array<{
    kind?: string;
    source?: string;
    from?: string;
    to?: string;
    value?: number | string;
    unit?: string;
    note?: string;
    threshold?: string;
    title?: string | null;
    publisher?: string | null;
    url?: string | null;
    accessed?: string | null;
    type?: string;
    quote?: string | null;
    series?: Array<{ date: string; dd: number; forecast?: boolean }>;
    stages?: Array<{ name: string; dd: number }>;
  }>;
  unknowns: string[];
  text: { title: Localised; action: Localised; why: Localised; scout: Localised | null };
  edited: boolean;
  textSource?: "ai" | "template" | "edited";
  aiSuggested?: boolean;
  snoozedUntil: string | null;
  undoUntil: string | null;
  /** Set when the agronomist asked the owner (pending within Undo, or a live decision). */
  askedOwnerAt?: string | null;
  decisionPending?: boolean;
  /** Detail only: the field's last crops before this season and the pest's library facts. */
  recentCrops?: Array<{ season: number; crop: string; name: Localised }>;
  pest?: {
    season: Localised;
    damage: Localised;
    riskWhen: Localised;
    note: Localised | null;
    hostCrops: string[];
  } | null;
}

function Step({
  n,
  title,
  stamp,
  children,
}: {
  n: number;
  title: string;
  /** Quiet data-source stamp under the step ("POWER · 14 Nov"). */
  stamp?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative">
      <span className="absolute top-0 -left-[38px] inline-flex size-7 items-center justify-center rounded-chip bg-ink text-small font-semibold text-surface">
        {n}
      </span>
      <h4 className="text-[18px] leading-7 font-semibold text-ink">{title}</h4>
      <div className="mt-1">{children}</div>
      {stamp && <p className="mt-2 text-caption text-ink-3">{stamp}</p>}
    </li>
  );
}

/** Semicircle risk gauge (design 09): green → amber → red, the needle on the level; grey when unknown. */
function Gauge({ level, label }: { level: RecView["level"]; label: string }) {
  const angle = { none: -80, low: -55, moderate: 0, high: 55, unknown: 0 }[level];
  const arc = (from: number, to: number) => {
    const p = (a: number) => {
      const r = ((a - 90) * Math.PI) / 180;
      return `${90 + 70 * Math.cos(r)} ${90 + 70 * Math.sin(r)}`;
    };
    return `M ${p(from)} A 70 70 0 0 1 ${p(to)}`;
  };
  const unknown = level === "unknown";
  return (
    <svg viewBox="0 0 180 100" role="img" aria-label={label} className="h-[100px] w-[180px]">
      <path
        d={arc(-88, -32)}
        className={unknown ? "stroke-line-strong" : "stroke-ok"}
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={arc(-26, 26)}
        className={unknown ? "stroke-line-strong" : "stroke-week"}
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={arc(32, 88)}
        className={unknown ? "stroke-line-strong" : "stroke-urgent"}
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      {!unknown && (
        <g transform={`rotate(${angle} 90 90)`}>
          <line
            x1="90"
            y1="90"
            x2="90"
            y2="38"
            className="stroke-ink"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>
      )}
      <circle cx="90" cy="90" r="7" className="fill-ink" />
    </svg>
  );
}

/** 910 + "MMDD" → "September 10"; days / seasons / m / NDVI read as plain values. */
function useThresholdValue() {
  const t = useTranslations("App");
  const fmt = useFormat();
  return (v: number | string | undefined, unit: string | undefined): string => {
    if (v === undefined) return "—";
    if (unit === "MMDD") {
      const n = Number(v);
      return fmt.date(new Date(Date.UTC(2001, Math.floor(n / 100) - 1, n % 100, 12)), "dayMonth", {
        timeZone: "UTC",
      });
    }
    if (unit === "days") return t("thr_unit_days", { n: Number(v) });
    if (unit === "seasons") return t("thr_unit_seasons", { n: Number(v) });
    if (unit === "NDVI") return String(v);
    return `${typeof v === "number" ? fmt.number(v) : v}${unit ? ` ${unit}` : ""}`;
  };
}

/** Accumulated heat from the degree-day evaluator's own series, with the threshold window (stage thresholds). */
function HeatChart({
  series,
  stages,
  alt,
  unit,
  fmt,
  num,
  legend,
}: {
  series: Array<{ date: string; dd: number; forecast?: boolean }>;
  stages: Array<{ name: string; dd: number }>;
  alt: string;
  unit: string;
  fmt: (iso: string) => string;
  num: (n: number) => string;
  legend: { observed: string; forecast: string; window: string };
}) {
  const W = 520;
  const H = 200;
  const pad = { l: 48, r: 12, t: 12, b: 32 };
  const lo = stages.length ? Math.min(...stages.map((s) => s.dd)) : 0;
  const hi = stages.length ? Math.max(...stages.map((s) => s.dd)) : 0;
  const yMax = Math.max(hi, ...series.map((p) => p.dd), 1) * 1.1;
  const x = (i: number) => pad.l + (i / Math.max(series.length - 1, 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const pts = (list: Array<[number, number]>) => list.map(([i, v]) => `${x(i)},${y(v)}`).join(" ");
  const firstFc = series.findIndex((p) => p.forecast);
  const obsEnd = firstFc === -1 ? series.length : firstFc;
  const observed = series.slice(0, obsEnd).map((p, i): [number, number] => [i, p.dd]);
  const forecast =
    firstFc === -1
      ? []
      : series
          .slice(Math.max(firstFc - 1, 0))
          .map((p, i): [number, number] => [Math.max(firstFc - 1, 0) + i, p.dd]);
  const ticks = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  return (
    <figure className="mt-3">
      {/* Fixed width keeps the 13 px text readable; on a phone the chart scrolls sideways instead of shrinking. */}
      <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={alt}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt} width={W} height={H} className="max-w-none">
        <rect
          x={pad.l}
          y={y(hi)}
          width={W - pad.l - pad.r}
          height={Math.max(y(lo) - y(hi), 2)}
          className="fill-week"
          fillOpacity={0.2}
        />
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="stroke-line-strong" />
        {[lo, hi].map((v, i) => (
          <text key={i} x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="fill-ink-2 text-[13px]">
            {num(Math.round(v))}
          </text>
        ))}
        {observed.length > 1 && (
          <polyline points={pts(observed)} fill="none" className="stroke-ink" strokeWidth="2.5" />
        )}
        {forecast.length > 1 && (
          <polyline
            points={pts(forecast)}
            fill="none"
            className="stroke-ink"
            strokeWidth="2.5"
            strokeDasharray="5 4"
          />
        )}
        {ticks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 10}
            textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}
            className="fill-ink-2 text-[13px]"
          >
            {fmt(series[i]!.date)}
          </text>
        ))}
      </svg>
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
        <span>{legend.observed}</span>
        {firstFc !== -1 && <span>{legend.forecast}</span>}
        <span>{legend.window}</span>
        <span className="sr-only">{unit}</span>
      </figcaption>
    </figure>
  );
}

const LEVEL_TONE = {
  high: "text-urgent",
  moderate: "text-week",
  low: "text-ok",
  none: "text-ok",
  unknown: "text-ink-2",
} as const;

/** Recommendation detail (design 09, S-04.06): why, what we don't know, citations, owner message; lifecycle actions. */
export function RecommendationClient({
  workspaceId,
  timeZone,
  canAct,
  canAsk = true,
  initial,
}: {
  workspaceId: string;
  timeZone: string;
  canAct: boolean;
  /** False for Owners: they never see "Ask the owner" (PD v2.9). */
  canAsk?: boolean;
  initial: RecView;
}) {
  const t = useTranslations("App");
  const r9 = useTranslations("Rec");
  const m = useTranslations("Main");
  const f = useTranslations("Field");
  const locale = useLocale() as "en" | "uk";
  const thresholdValue = useThresholdValue();
  const fmt = useFormat();
  const client = useQueryClient();
  const key = ["recommendation", workspaceId, initial.id];
  const rec = useQuery({
    queryKey: key,
    queryFn: () => api<RecView>(`/api/w/${workspaceId}/recommendations/${initial.id}`),
    initialData: initial,
  });
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);
  const router = useRouter();
  const { fail } = useActionToast();
  const editRef = useRef<HTMLFormElement>(null);
  // The undo window ends with a refetch; don't leave the timer running after the page closes.
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );
  async function startCheck() {
    try {
      const task = await api<{ id: string }>(
        `/api/w/${workspaceId}/recommendations/${initial.id}/scouting-tasks`,
        { body: {} },
      );
      router.push(`/scout/${task.id}`);
    } catch (e) {
      fail(e, t("scStart"), () => void startCheck());
    }
  }
  const r = rec.data;
  const base = `/api/w/${workspaceId}/recommendations/${r.id}`;

  const date = (iso: string) => fmt.date(`${iso}T12:00:00Z`, "dayMonth", { timeZone: "UTC" });
  const when = (iso: string) => fmt.date(iso, "dateTime", { timeZone });
  /** Numbers read through the locale; text passes through. */
  const val = (v: number | string) => (typeof v === "number" ? fmt.number(v) : isoOrText(String(v)));
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const isoOrText = (v: string) => (ISO_RE.test(v) ? date(v) : v);
  const label = (id: string) => (t.has(`kn_${id}`) ? t(`kn_${id}`) : id);
  const evidence = r.evidence ?? [];
  const inputs = evidence.filter((e) => e.kind !== "citation");
  const citations = evidence.filter((e) => e.kind === "citation");
  const unknowns = r.unknowns ?? [];
  const short = (src?: string) => (src ? src.split(" (")[0]!.split(";")[0]! : undefined);
  /** Short source chip: "POWER · 2026-11-14", "CDL 2023–2026". */
  const chip = (e?: RecView["evidence"][number]) => {
    const s = e?.source;
    if (!s) return undefined;
    if (/POWER/.test(s)) return `NASA POWER${e.to ? ` · ${isoOrText(e.to)}` : ""}`;
    if (/Crop history/i.test(s)) return `USDA CDL ${e.from?.slice(0, 4) ?? ""}–${e.to?.slice(0, 4) ?? ""}`;
    if (/Sentinel/i.test(s)) return `Sentinel-2${e.to ? ` · ${isoOrText(e.to)}` : ""}`;
    if (/Open-Meteo/i.test(s)) return "Open-Meteo";
    return short(s)?.slice(0, 28);
  };
  /** What was checked, in plain words; the source id never becomes a title. */
  const stepTitle = (e: RecView["evidence"][number]) => {
    const src = e.source ?? "";
    if (/POWER|Open-Meteo|NWS/i.test(src)) return r9("step_weather");
    if (/Crop history|CDL/i.test(src)) return r9("step_crops");
    if (/Sentinel|MODIS|NDVI/i.test(src)) return r9("step_greenness");
    if (/SSURGO|SoilGrids|soil/i.test(src)) return r9("step_soil");
    return r9("step_other");
  };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const crops = r.recentCrops ?? [];
  const hostSeasons = crops.filter((c) => r.pest?.hostCrops.includes(c.crop)).length;
  const sourceFor = (id: string) => {
    const re = /^(hostSeasons|lastCrop)/.test(id)
      ? /Crop history/i
      : /^(degree|autumn|daysSinceEmergence|frost|daysUntilFrost)/.test(id)
        ? /POWER|Open-Meteo/
        : null;
    return chip((re && inputs.find((e) => re.test(e.source ?? ""))) || inputs[0]);
  };
  const factors: Factor[] = (r.keyNumbers ?? []).map((k) => {
    const num = typeof k.value === "number" ? k.value : Number(k.value);
    const source = sourceFor(k.id);
    const tail = source ? { source } : {};
    if (
      t.has(`knS_${k.id}`) &&
      k.value !== "" &&
      k.value !== "—" &&
      (Number.isFinite(num) || ISO_RE.test(String(k.value)))
    )
      return {
        label: t(`knS_${k.id}`, { n: Number.isFinite(num) ? num : 0, v: isoOrText(String(k.value)) }),
        weight: k.weight,
        ...tail,
      };
    return {
      label: label(k.id),
      value: `${val(k.value)}${k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}`,
      weight: k.weight,
      ...tail,
    };
  });
  const heat = inputs.find((e) => (e.series?.length ?? 0) > 1);

  async function act(action: "accept" | "snooze" | "dismiss" | "undo" | "ask-owner", note?: string) {
    const body: AskOwnerBody = action === "ask-owner" && note ? { note } : {};
    try {
      const next = await api<RecView>(`${base}/${action}`, { body });
      setAsked(action === "ask-owner");
      client.setQueryData(key, { ...r, ...next });
      void client.invalidateQueries({ queryKey: ["brief", workspaceId] });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (next.undoUntil)
        undoTimer.current = setTimeout(
          () => void rec.refetch(),
          new Date(next.undoUntil).getTime() - Date.now() + 1_500,
        );
    } catch (e) {
      const what = {
        accept: t("acceptBtn"),
        snooze: m("snooze"),
        dismiss: r9("not_relevant"),
        undo: r9("undo"),
        "ask-owner": t("askBtn"),
      }[action];
      fail(e, what, () => void act(action, note));
    }
  }
  /** One textarea: what to change and why. It replaces the action text in this language; the rest stays as is. */
  async function saveText(text: string) {
    const v = text.trim();
    if (!v) return;
    try {
      const next = await api<RecView>(base, {
        method: "PATCH",
        body: {
          title: { en: r.text.title.en, uk: r.text.title.uk },
          action: { ...r.text.action, [locale]: v },
        },
      });
      client.setQueryData(key, { ...r, ...next });
      setEditing(false);
    } catch (e) {
      fail(e, t("recSaveText"), () => void saveText(text));
    }
  }
  const [draft, setDraft] = useState("");
  function startEdit() {
    setDraft(r.text.action[locale]);
    setEditing(true);
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  const askedOwner = asked || Boolean(r.askedOwnerAt);
  const status = askedOwner
    ? t("recStatus_asked")
    : r.status === "accepted" || r.status === "in_report"
      ? t("recStatus_accepted")
      : r.status === "snoozed"
        ? t("recStatus_snoozed", { when: r.snoozedUntil ? when(r.snoozedUntil) : "—" })
        : r.status === "dismissed"
          ? t("recStatus_dismissed")
          : r.status === "expired"
            ? t("recStatus_expired")
            : null;
  const message = t("recMsg", {
    field: r.fieldName,
    title: r.text.title[locale],
    action: r.text.action[locale],
  });

  const open = r.status === "open";
  const live = open || r.status === "accepted" || r.status === "in_report";
  const menuItems: MenuItem[] = [];
  if (open) menuItems.push({ id: "snooze", label: m("snooze"), icon: <Clock />, onSelect: () => void act("snooze") });
  if (r.planning || r.type === "rotation")
    menuItems.push({
      id: "compare",
      label: r9("compare"),
      icon: <RefreshCw />,
      onSelect: () => router.push(`/fields/${r.fieldId}/rotation`),
    });
  menuItems.push({ id: "edit", label: r9("edit"), icon: <Pencil />, onSelect: startEdit });
  if (open)
    menuItems.push({
      id: "dismiss",
      label: r9("not_relevant"),
      icon: <ThumbsDown />,
      danger: true,
      onSelect: () => void act("dismiss"),
    });
  const canAskNow = canAct && canAsk && live && !askedOwner && !r.undoUntil;

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <nav aria-label={t("breadcrumb")} className="flex w-fit items-center gap-2 text-body text-ink-2">
          <Link href="/" className="flex items-center gap-1 hover:text-ink">
            <ArrowLeft aria-hidden className="size-4" />
            {r9("back")}
          </Link>
          <span aria-hidden>/</span>
          <span aria-current="page" className="text-ink">
            {r9("crumb")}
          </span>
        </nav>
        <div className="flex flex-wrap gap-2">
          {r.deadline && (
            <Chip tone={r.planning ? "info" : r.irreversible ? "urgent" : "week"} icon={<Calendar />}>
              {r.planning ? t("duePlan", { date: date(r.deadline) }) : t("dueBy", { date: date(r.deadline) })}
            </Chip>
          )}
          <Chip tone="neutral" icon={<Bug />}>
            {t(`type_${r.type}`)}
          </Chip>
          {r.edited && <Chip tone="neutral">{t("recEdited")}</Chip>}
          {r.aiSuggested && <Chip tone="neutral" icon={<Sparkles />}>{t("aiWatchChip")}</Chip>}
        </div>
        <div>
          <h1 className="text-h1 text-ink">
            {r.text.title[locale]}
            {r.textSource === "ai" && <AiMark />}
          </h1>
          {r.aiSuggested && <p className="mt-2 text-small text-ink-2">{t("aiWorthPageNote")}</p>}
          <p className="mt-2 text-body text-ink-2">
            {r.fieldName} · {t("recSeason", { season: r.season })}
          </p>
        </div>

        <Surface as="section" pad="lg" className="flex flex-col gap-5">
          <Gauge level={r.level} label={`${r9("risk")}: ${t(`recLevel_${r.level}`)}`} />
          <dl className="flex flex-wrap gap-8">
            <div>
              <dt className="text-caption text-ink-2">{r9("risk")}</dt>
              <dd className={`text-h2 ${LEVEL_TONE[r.level]}`}>{t(`recLevel_${r.level}`)}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-2">
                {r9("conf")} <InfoHint label={t("hintLabel")}>{t("hintConf")}</InfoHint>
              </dt>
              <dd className="text-h2 text-ink">{t(`conf_${r.confidence}`)}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-2">
                {r9("data")}{" "}
                <InfoHint label={t("hintLabel")}>{t(`hintTier_${r.tier}` as "hintTier_A")}</InfoHint>
              </dt>
              <dd className="text-h2 text-ink">{f(`tier_${r.tier}`)}</dd>
            </div>
          </dl>
          <div>
            <Kicker as="h2" className="mb-2">
              {r9("do_t")}
            </Kicker>
            <p className="text-[20px] leading-8 font-semibold text-ink">{r.text.action[locale]}</p>
          </div>
          {status && (
            <p role="status" className="flex items-center gap-2 text-body text-ink-2">
              <Check aria-hidden className="size-4 shrink-0" strokeWidth={1.7} />
              {status}
            </p>
          )}
          {r.undoUntil ? (
            <DoneRow
              label={askedOwner ? t("askDone") : r.status === "accepted" ? t("accDone") : m("snz_done")}
              undoLabel={r9("undo")}
              undoUntil={r.undoUntil}
              onUndo={() => void act("undo")}
            />
          ) : (
            canAct &&
            live && (
              <div className="flex flex-wrap items-center gap-2">
                {open && (
                  <Button icon={<Check />} onClick={() => void act("accept")}>
                    {t("acceptBtn")}
                  </Button>
                )}
                {canAskNow && (
                  <Button
                    variant={open ? "outline" : "primary"}
                    icon={<MessageCircleQuestion />}
                    onClick={() => setAsking(true)}
                  >
                    {t("askBtn")}
                  </Button>
                )}
                <Menu label={r9("more")} items={menuItems} className="ml-auto" />
              </div>
            )
          )}
        </Surface>

        <Surface as="section" pad="lg">
         <Disclosure summary={<span className="text-h2">{r9("why_t")}</span>}>
          <div className="flex flex-col gap-5 pt-4">
          {factors.length > 0 && (
            <div className="rounded-input bg-surface-2 p-4">
              <h3 className="mb-2 text-body font-semibold text-ink">{t("recWhyFactors")}</h3>
              <FactorRows factors={factors} />
            </div>
          )}
          <div>
            <h3 className="mb-2 text-body font-semibold text-ink">{t("recSteps")}</h3>
            <p className="mb-4 text-body text-ink">{r.text.why[locale]}</p>
            <ol className="relative flex flex-col gap-6 border-l border-line pl-6">
              {crops.length > 0 && (
                <Step n={1} title={t("rcStepCrops")}>
                  {r.pest && (
                    <p className="text-body text-ink-2">
                      {t("rcStepCropsSub", { n: hostSeasons, total: crops.length })}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {crops.map((c) => (
                      <div key={c.season} className="flex w-[92px] flex-col items-center gap-1">
                        <span
                          className="h-12 w-full rounded-input"
                          style={{ backgroundColor: cropColour(c.crop) }}
                          title={c.name[locale]}
                        />
                        <span className="text-small font-semibold text-ink">{c.season}</span>
                        <span className="text-center text-small leading-tight text-ink-2">
                          {c.name[locale]}
                        </span>
                      </div>
                    ))}
                    {r.planning && (
                      <div className="flex w-[92px] flex-col items-center gap-1">
                        <span className="h-12 w-full rounded-input border-2 border-dashed border-week" />
                        <span className="text-small font-semibold text-ink">{r.season}</span>
                        <span className="text-caption font-semibold text-urgent">{t("rcPlan")}</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-caption text-ink-3">USDA Cropland Data Layer · {t("rcHistorySrc")}</p>
                </Step>
              )}
              {inputs.map((e, i) => (
                <Step
                  key={i}
                  n={i + 1 + (crops.length > 0 ? 1 : 0)}
                  title={stepTitle(e)}
                  stamp={chip(e)}
                >
                  <p className="text-body text-ink-2">
                    {[
                      e.from ? `${isoOrText(e.from)}${e.to ? ` → ${isoOrText(e.to)}` : ""}` : null,
                      e.value !== undefined && !UUID_RE.test(String(e.value))
                        ? `${val(e.value)}${e.unit ? ` ${e.unit}` : ""}`
                        : null,
                      e.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {e === heat && heat.series && (
                    <>
                      <p className="mt-3 text-small font-semibold text-ink">
                        {t("rcChartTitle", { unit: heat.unit ?? "°C·d" })}
                      </p>
                      <HeatChart
                        series={heat.series}
                        stages={heat.stages ?? []}
                        unit={heat.unit ?? "°C·d"}
                        fmt={date}
                        num={fmt.number}
                        alt={t("rcChartAlt", {
                          from: date(heat.series[0]!.date),
                          to: date(heat.series.at(-1)!.date),
                          now: String(heat.value ?? "—"),
                          unit: heat.unit ?? "°C·d",
                          a: Math.round(Math.min(...(heat.stages ?? [{ dd: 0 }]).map((s) => s.dd))),
                          b: Math.round(Math.max(...(heat.stages ?? [{ dd: 0 }]).map((s) => s.dd))),
                        })}
                        legend={{
                          observed: t("rcChartObserved"),
                          forecast: t("rcChartForecast"),
                          window: t("rcChartWindow", {
                            a: Math.round(Math.min(...(heat.stages ?? [{ dd: 0 }]).map((s) => s.dd))),
                            b: Math.round(Math.max(...(heat.stages ?? [{ dd: 0 }]).map((s) => s.dd))),
                            unit: heat.unit ?? "°C·d",
                          }),
                        }}
                      />
                    </>
                  )}
                </Step>
              ))}
              {r.pest && (
                <Step n={inputs.length + 1 + (crops.length > 0 ? 1 : 0)} title={t("rcStepWhen")}>
                  <p className="text-body text-ink">{r.pest.season[locale]}</p>
                  <p className="mt-1 text-body text-ink-2">{r.pest.damage[locale]}</p>
                </Step>
              )}
            </ol>
          </div>
          <div>
            <h3 className="mb-2 text-body font-semibold text-ink">{t("recUnknown")}</h3>
            {unknowns.length ? (
              <ul className="list-disc pl-5 text-small text-ink-2">
                {unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-ink-2">{t("recNothingUnknown")}</p>
            )}
          </div>
          </div>
         </Disclosure>
        </Surface>

        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-ink">{t("rcOptions")}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="flex flex-col gap-3 rounded-card border-2 border-ink bg-surface p-5">
              <div className="flex items-center gap-2">
                <Sparkles aria-hidden className="size-5 text-ink" strokeWidth={1.7} />
                <Chip tone="neutral">{t("rcOptRec")}</Chip>
              </div>
              <h3 className="text-body font-bold text-ink">{r.text.title[locale]}</h3>
              <p className="text-small text-ink-2">{r.text.action[locale]}</p>
            </article>
            {r.text.scout && (
              <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                <Eye aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
                <h3 className="text-body font-semibold text-ink">{t("rcOptScout")}</h3>
                <p className="text-small text-ink-2">{r.text.scout[locale]}</p>
              </article>
            )}
            {r.type === "rotation" && (
              <>
                <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                  <RefreshCw aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
                  <h3 className="text-body font-semibold text-ink">{t("rcOptCompare")}</h3>
                  <p className="text-small text-ink-2">{t("rcOptCompareSub")}</p>
                </article>
                <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                  <Eye aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
                  <h3 className="text-body font-semibold text-ink">{t("rcOptKeep")}</h3>
                  <p className="text-small text-ink-2">{t("rcOptKeepSub")}</p>
                </article>
              </>
            )}
            {r.pest && (
              <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                <TriangleAlert aria-hidden className="size-5 text-ink-2" strokeWidth={1.7} />
                <h3 className="text-body font-semibold text-ink">{t("rcOptRisk")}</h3>
                <p className="text-small text-ink-2">{r.pest.riskWhen[locale]}</p>
                {r.pest.note && <p className="text-caption text-ink-3">{r.pest.note[locale]}</p>}
              </article>
            )}
          </div>
          <p className="text-small text-ink-3">{t("rcNoProducts")}</p>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        {canAct && (r.type === "pest" || r.type === "disease") && (
          <Button icon={<Bug />} onClick={() => void startCheck()} className="justify-center">
            {t("scStart")}
          </Button>
        )}
        {canAct && (
          <Link
            href={`/assistant?rec=${r.id}&field=${r.fieldId}`}
            className="focus-ring flex items-center justify-center gap-2 rounded-btn border border-line-strong bg-surface px-4 py-3 text-body font-semibold text-ink hover:bg-muted"
          >
            <Sparkles aria-hidden className="size-4" strokeWidth={1.7} />
            {f("bf_ask")}
          </Link>
        )}
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-body font-semibold text-ink">{t("recMsgTitle")}</h2>
          <p className="mt-3 rounded-input bg-surface-2 p-4 text-body text-ink">{message}</p>
          <p className="mt-3 flex items-center gap-1.5 text-small font-semibold text-ok">
            <ShieldCheck aria-hidden className="size-4" strokeWidth={1.7} />
            {r9("msg_ok")}
          </p>
          {canAct && editing && (
            <form
              ref={editRef}
              onSubmit={(e) => {
                e.preventDefault();
                void saveText(draft);
              }}
              className="mt-3 flex flex-col gap-3"
            >
              <label className="flex flex-col gap-1 text-caption text-ink-2">
                {r9("edit_label")}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  required
                  maxLength={2000}
                  className="focus-ring min-h-28 rounded-input border border-line-strong bg-surface p-3 text-body text-ink"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit">{t("recSaveText")}</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {t("recCancel")}
                </Button>
              </div>
            </form>
          )}
        </section>
        <Surface as="section">
          <Disclosure summary={r9("src_thr_t")}>
            <div className="flex flex-col gap-4 pt-3">
              {citations.length > 0 && (
                <ul className="flex flex-col gap-3 text-caption text-ink-2">
                  {citations.map((c) => (
                    <li key={c.threshold}>
                      <span className="block text-ink">
                        {t.has(`thr_${c.threshold}`)
                          ? t(`thr_${c.threshold}`)
                          : c.threshold?.replace(/([A-Z])/g, " $1").toLowerCase()}
                        : <span className="font-mono font-semibold">{thresholdValue(c.value, c.unit)}</span>
                      </span>
                      <span className="block">
                        {c.url ? (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                          >
                            {c.title}
                          </a>
                        ) : (
                          c.title
                        )}
                        {c.publisher && ` · ${c.publisher}`}
                        {c.type === "calibration" && ` · ${t("recCalibration")}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="list-disc pl-5 text-caption text-ink-2">
                {[...new Set(inputs.map((e) => e.source).filter(Boolean))].map((s) => (
                  <li key={s}>{s}</li>
                ))}
                {crops.length > 0 && <li>USDA Cropland Data Layer</li>}
                {r.pest && <li>{r9("src_library")}</li>}
              </ul>
              <p className="flex items-center gap-1.5 text-caption text-ink-3">
                <ShieldCheck aria-hidden className="size-3.5" strokeWidth={1.7} />
                {m("neutral")}
              </p>
            </div>
          </Disclosure>
        </Surface>
      </aside>
      <AskOwnerSheet
        preview={
          asking && canAsk
            ? {
                fieldName: r.fieldName,
                title: r.text.title[locale],
                action: r.text.action[locale],
                deadline: r.deadline ? date(r.deadline) : "",
                numbers: r.keyNumbers.slice(0, 3).map((k) => ({
                  label: label(k.id),
                  value: `${isoOrText(String(k.value))}${k.unit && k.unit !== "seasons" ? ` ${k.unit}` : ""}`,
                })),
              }
            : null
        }
        onClose={() => setAsking(false)}
        onSend={(note) => {
          setAsking(false);
          void act("ask-owner", note || undefined);
        }}
      />
    </div>
  );
}
