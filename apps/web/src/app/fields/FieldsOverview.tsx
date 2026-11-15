"use client";

import { useQuery } from "@tanstack/react-query";
import { Chip, ErrorCard, FieldThumb, Surface, Tabs } from "@terrasight/ui";
import { CheckCircle2, ChevronRight, Clock, Map as MapIcon, MapPin, OctagonAlert, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { LandChip, type LandStatus } from "@/components/LandSuitability";
import { QueryState } from "@/components/QueryState";
import { TrustLine } from "@/components/TrustLine";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/useFormat";

type Localised = { en: string; uk: string };
type Urgency = "urgent" | "this_week" | "all_good";
interface Row {
  fieldId: string;
  name: string;
  areaHa: number;
  lastCrop: Localised | null;
  lastCropId?: string | null;
  suitabilityStatus?: LandStatus | null;
  suitabilityOverridden?: boolean;
  thumb?: string | null;
  urgency: Urgency;
  next: { id: string; title: Localised; deadline: string | null; more: number; plan?: boolean } | null;
}
export interface FieldsOverviewData {
  totalHa: number;
  counties: Array<{
    key: string;
    county: string;
    state: string | null;
    lon: number;
    lat: number;
    urgency: Urgency;
    areaHa: number;
    weather: { tminC: number | null; tmaxC: number | null; precipMm?: number | null } | null;
    fields: Row[];
  }>;
  states: Array<{
    code: string;
    name: string;
    geometry: { type: string; coordinates: number[][][][] | number[][][] };
  }>;
}

const TONE: Record<Urgency, "urgent" | "week" | "ok"> = {
  urgent: "urgent",
  this_week: "week",
  all_good: "ok",
};
/** ISO 3166-2:UA oblast names in Ukrainian (the boundary table stores English names only). */
const UA_OBLAST: Record<string, string> = {
  "UA-05": "Вінницька",
  "UA-07": "Волинська",
  "UA-09": "Луганська",
  "UA-12": "Дніпропетровська",
  "UA-14": "Донецька",
  "UA-18": "Житомирська",
  "UA-21": "Закарпатська",
  "UA-23": "Запорізька",
  "UA-26": "Івано-Франківська",
  "UA-30": "м. Київ",
  "UA-32": "Київська",
  "UA-35": "Кіровоградська",
  "UA-40": "м. Севастополь",
  "UA-43": "АР Крим",
  "UA-46": "Львівська",
  "UA-48": "Миколаївська",
  "UA-51": "Одеська",
  "UA-53": "Полтавська",
  "UA-56": "Рівненська",
  "UA-59": "Сумська",
  "UA-61": "Тернопільська",
  "UA-63": "Харківська",
  "UA-65": "Херсонська",
  "UA-68": "Хмельницька",
  "UA-71": "Черкаська",
  "UA-74": "Чернігівська",
  "UA-77": "Чернівецька",
};
const countryOf = (c: { state: string | null }) => c.state?.split("-")[0] ?? "";
const PIN: Record<Urgency, string> = { urgent: "fill-urgent", this_week: "fill-week", all_good: "fill-ok" };
const STATUS_KEY = { urgent: "stUrgent", this_week: "stWeek", all_good: "stOk" } as const;
const STATUS_ICON = { urgent: OctagonAlert, this_week: Clock, all_good: CheckCircle2 } as const;
/** Data tier by country: A = US, B = EU, C = the rest (including Ukraine). Mirrors the API's place lookup. */
const EU = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "),
);
export const tierOf = (country: string): "A" | "B" | "C" =>
  country === "US" ? "A" : EU.has(country) ? "B" : "C";

/** Fields (design 07, S-04.08): county chips, a schematic map with one pin per county, the list grouped by county. */
export function FieldsOverview({
  data: initial,
  canEdit,
  workspaceId,
}: {
  data: FieldsOverviewData;
  /** Workspace setting; not used here: each field shows the units of its own country. */
  units?: "metric" | "imperial";
  canEdit: boolean;
  workspaceId: string;
}) {
  const f = useTranslations("Fields");
  const router = useRouter();
  // The server already fetched the page; the query keeps it fresh and shows the error card with Retry if a refresh fails.
  const query = useQuery({
    queryKey: ["fields-overview", workspaceId],
    queryFn: () => api<FieldsOverviewData>(`/api/w/${workspaceId}/fields-overview`),
    initialData: initial,
    staleTime: 30_000,
  });
  return (
    <QueryState
      query={query}
      skeletonVariant="rows"
      what={f("loadWhat")}
      isEmpty={(d) => d.counties.length === 0}
      empty={{ text: f("emptyText"), actionLabel: f("emptyAction"), onAction: () => router.push("/fields/new") }}
    >
      {(data) => <Body data={data} canEdit={canEdit} />}
    </QueryState>
  );
}

/** Load error for the page (the server could not fetch the list): the unified error card with Retry. */
export function FieldsLoadError() {
  const t = useTranslations("App");
  const f = useTranslations("Fields");
  const router = useRouter();
  return (
    <ErrorCard
      title={t("qsErrWhat", { what: f("loadWhat") })}
      body={t("qsErrBody")}
      retryLabel={t("retry")}
      onRetry={() => router.refresh()}
    />
  );
}

function Body({ data, canEdit }: { data: FieldsOverviewData; canEdit: boolean }) {
  const t = useTranslations("App");
  const f = useTranslations("Fields");
  const router = useRouter();
  const locale = useLocale() as "en" | "uk";
  // Units follow each field's own country (US: ac, °F, in; everywhere else: ha, °C, mm), not the workspace setting.
  const fmtUS = useFormat({ units: "imperial" });
  const fmtMetric = useFormat({ units: "metric" });
  const fmtFor = (cc: string) => (cc === "US" ? fmtUS : fmtMetric);
  const [filter, setFilter] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // Open on a laptop only when the company works in 3 or more regions; closed on a phone.
  useEffect(() => {
    if (data.counties.length >= 3 && window.matchMedia("(min-width: 1024px)").matches) setMapOpen(true);
  }, [data.counties.length]);
  const date = (iso: string) => fmtUS.dateRel(`${iso}T12:00:00Z`, { timeZone: "UTC", style: "short" });
  const countryName = (cc: string) => {
    try {
      return new Intl.DisplayNames(locale === "uk" ? "uk-UA" : "en-US", { type: "region" }).of(cc) ?? cc;
    } catch {
      return cc;
    }
  };
  /** US states and other admin areas: the name the API sends with the outline, never the raw code. */
  const areaName = (code: string | null) =>
    (code && data.states.find((s) => s.code === code)?.name) || code?.split("-")[1] || "";
  const oblast = (state: string | null, fallback: string) =>
    locale === "uk" && state && UA_OBLAST[state]
      ? state === "UA-30" || state === "UA-40"
        ? UA_OBLAST[state]
        : `${UA_OBLAST[state]} обл.`
      : fallback;
  const label = (c: FieldsOverviewData["counties"][number]) =>
    countryOf(c) === "UA" ? oblast(c.state, c.county) : `${areaName(c.state)} · ${c.county}`;
  const stateName = (code: string, name: string) => (code.startsWith("UA-") ? oblast(code, name) : name);
  const weatherText = (c: FieldsOverviewData["counties"][number]) => {
    const w = c.weather!;
    const fmt = fmtFor(countryOf(c));
    const temp = (v: number | null) => (v === null ? "—" : fmt.temp(v));
    return [
      `${temp(w.tminC)} / ${temp(w.tmaxC)}`,
      w.precipMm == null
        ? null
        : w.precipMm < 0.2
          ? t("fpDry")
          : t("fpRain", { mm: fmt.rain(w.precipMm) }),
    ]
      .filter(Boolean)
      .join(", ");
  };
  const countries = [...new Set(data.counties.map(countryOf))];
  const [mapCountry, setMapCountry] = useState<string | null>(null);
  const activeCountry =
    (filter ? countryOf(data.counties.find((c) => c.key === filter) ?? { state: null }) : mapCountry) ??
    countries[0] ??
    "";
  const n = data.counties.reduce((s, c) => s + c.fields.length, 0);

  // Project state outlines and county pins into the map box (equirectangular, scaled by cos(lat)),
  // then push overlapping pins apart (leader line back to the true spot) and place labels without collisions.
  const map = useMemo(() => {
    const counties = data.counties.filter((c) => countryOf(c) === activeCountry);
    const rings = data.states
      .filter((s) => s.code.split("-")[0] === activeCountry)
      .flatMap((s) =>
        s.geometry.type === "MultiPolygon"
          ? (s.geometry.coordinates as number[][][][]).map((p) => ({
              code: s.code,
              name: s.name,
              ring: p[0]!,
            }))
          : [{ code: s.code, name: s.name, ring: (s.geometry.coordinates as number[][][])[0]! }],
      );
    const pts = [...rings.flatMap((r) => r.ring), ...counties.map((c) => [c.lon, c.lat])];
    if (!pts.length) return null;
    const lons = pts.map((p) => p[0]!);
    const lats = pts.map((p) => p[1]!);
    let [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    // Without outlines the box is just the pins: keep a minimum span so a single pin sits centred.
    if (x1 - x0 < 1) [x0, x1] = [(x0 + x1) / 2 - 0.5, (x0 + x1) / 2 + 0.5];
    if (y1 - y0 < 0.6) [y0, y1] = [(y0 + y1) / 2 - 0.3, (y0 + y1) / 2 + 0.3];
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const s = Math.min(560 / ((x1 - x0) * k), 280 / (y1 - y0));
    const ox = 40 + (560 - (x1 - x0) * k * s) / 2;
    const oy = 310 - (280 - (y1 - y0) * s) / 2;
    const P = (lon: number, lat: number): [number, number] => [ox + (lon - x0) * k * s, oy - (lat - y0) * s];
    const pins = counties.map((c) => {
      const home = P(c.lon, c.lat);
      return { c, home, xy: [...home] as [number, number] };
    });
    const MIN = 30;
    for (let it = 0; it < 80; it++)
      for (let i = 0; i < pins.length; i++)
        for (let j = i + 1; j < pins.length; j++) {
          const a = pins[i]!.xy;
          const b = pins[j]!.xy;
          let dx = b[0] - a[0];
          let dy = b[1] - a[1];
          let d = Math.hypot(dx, dy);
          if (d >= MIN) continue;
          if (d < 0.01) [dx, dy, d] = [Math.cos(i + j), Math.sin(i + j), 1];
          const m = (MIN - d) / 2 / d;
          a[0] -= dx * m;
          a[1] -= dy * m;
          b[0] += dx * m;
          b[1] += dy * m;
        }
    for (const p of pins) {
      p.xy[0] = Math.min(Math.max(p.xy[0], 16), 624);
      p.xy[1] = Math.min(Math.max(p.xy[1], 16), 324);
    }
    // Labels: try right, left, below, above; take the first that stays in the box and misses pins and other labels.
    type Box = [number, number, number, number];
    const boxes: Box[] = pins.map((p) => [p.xy[0] - 15, p.xy[1] - 15, p.xy[0] + 15, p.xy[1] + 15]);
    const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const placed: Array<{ x: number; y: number; anchor: "start" | "middle" | "end"; text: string }> = [];
    const taken: Box[] = [];
    for (const [i, p] of pins.entries()) {
      const text = p.c.county.replace(/ County$/, "");
      const text2 = countryOf(p.c) === "UA" ? oblast(p.c.state, text).replace(/ обл\.$/, "") : text;
      const w = text2.length * 6.8;
      const [x, y] = p.xy;
      const cands: Array<[number, number, "start" | "middle" | "end", Box]> = [
        [x + 19, y + 4, "start", [x + 17, y - 9, x + 21 + w, y + 9]],
        [x - 19, y + 4, "end", [x - 21 - w, y - 9, x - 17, y + 9]],
        [x, y + 29, "middle", [x - w / 2 - 2, y + 17, x + w / 2 + 2, y + 35]],
        [x, y - 22, "middle", [x - w / 2 - 2, y - 35, x + w / 2 + 2, y - 17]],
      ];
      const ok = (b: Box) =>
        b[0] >= 0 &&
        b[2] <= 640 &&
        b[1] >= 0 &&
        b[3] <= 340 &&
        !taken.some((t2) => hit(b, t2)) &&
        !boxes.some((o, j) => j !== i && hit(b, o));
      const c = cands.find((cd) => ok(cd[3])) ?? cands[0]!;
      taken.push(c[3]);
      placed.push({ x: c[0], y: c[1], anchor: c[2], text: text2 });
    }
    const biggest = new Map<string, number>();
    for (const r of rings) biggest.set(r.code, Math.max(biggest.get(r.code) ?? 0, r.ring.length));
    return {
      states: rings.map((r) => {
        const xy = r.ring.map(([lon, lat]) => P(lon!, lat!));
        const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length;
        const cy = xy.reduce((a, p) => a + p[1], 0) / xy.length;
        return {
          code: r.code,
          name: r.name,
          d: xy.map((p) => p.join(",")).join(" "),
          cx,
          cy,
          main: r.ring.length === biggest.get(r.code),
        };
      }),
      pins: pins.map((p, i) => ({ ...p, label: placed[i]! })),
    };
  }, [data, activeCountry, locale]);

  const shown = data.counties.filter((c) => !filter || c.key === filter);
  const rank: Record<Urgency, number> = { urgent: 0, this_week: 1, all_good: 2 };
  const attention = shown
    .flatMap((c) => c.fields.filter((fl) => fl.urgency !== "all_good").map((fl) => ({ fl, c })))
    .sort((x, y) => rank[x.fl.urgency] - rank[y.fl.urgency] || x.fl.name.localeCompare(y.fl.name));
  const calm = shown
    .map((c) => ({ c, fields: c.fields.filter((fl) => fl.urgency === "all_good") }))
    .filter((g) => g.fields.length > 0);
  const counts = {
    urgent: data.counties.reduce((a, c) => a + c.fields.filter((fl) => fl.urgency === "urgent").length, 0),
    week: data.counties.reduce((a, c) => a + c.fields.filter((fl) => fl.urgency === "this_week").length, 0),
  };
  const summary = [
    f("sumFields", { n }),
    counts.urgent > 0 ? f("sumUrgent", { n: counts.urgent }) : null,
    counts.week > 0 ? f("sumWeek", { n: counts.week }) : null,
    counts.urgent + counts.week === 0 ? f("sumOk") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const selected = data.counties.find((c) => c.key === filter) ?? null;
  const statusText = (u: Urgency) => f(STATUS_KEY[u]);
  const pinKey = (c: FieldsOverviewData["counties"][number]) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const only = c.fields[0];
    if (e.key === "Enter" && only && c.fields.length === 1) router.push(`/fields/${only.fieldId}`);
    else setFilter(filter === c.key ? null : c.key);
  };
  let rowNo = 0;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ink">{t("fieldsTitle")}</h1>
          <p className="text-body text-ink-2">{summary}</p>
        </div>
        {canEdit && (
          <Link
            href="/fields/new"
            className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-btn bg-ink px-5 text-body font-semibold text-surface"
          >
            <Plus aria-hidden className="size-5" strokeWidth={1.7} />
            {t("addField")}
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {data.counties.length > 1 && (
          <select
            aria-label={f("regionMenu")}
            value={filter ?? ""}
            onChange={(e) => setFilter(e.target.value || null)}
            className="focus-ring min-h-tap rounded-btn border border-line-control bg-surface px-3 text-body text-ink"
          >
            <option value="">{f("regionAll")}</option>
            {data.counties.map((c) => (
              <option key={c.key} value={c.key}>
                {label(c)}
              </option>
            ))}
          </select>
        )}
        {map && (
          <button
            type="button"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((o) => !o)}
            className="focus-ring inline-flex min-h-tap items-center gap-2 rounded-btn border border-line-control bg-surface px-4 text-body font-semibold text-ink"
          >
            <MapIcon aria-hidden className="size-5" strokeWidth={1.7} />
            {mapOpen ? f("hideMap") : f("showMap")}
          </button>
        )}
      </div>
      {selected && (
        <p role="status" className="-mt-3 flex flex-wrap items-center gap-2 text-small text-ink-2">
          {f("selected", { name: label(selected) })}
          <button type="button" onClick={() => setFilter(null)} className="focus-ring min-h-tap font-semibold text-ink underline underline-offset-4">
            {f("showAll")}
          </button>
        </p>
      )}

      {map && mapOpen && (
        <Surface as="section" pad="lg" className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div>
            {countries.length > 1 && !filter && (
              <Tabs
                label={f("mapCountry")}
                value={activeCountry}
                onChange={setMapCountry}
                items={countries.map((cc) => ({
                  id: cc,
                  label: cc === "UA" ? t("fpUkraine") : cc === "US" ? t("fpUsa") : countryName(cc),
                }))}
                className="mb-2"
              />
            )}
            <svg viewBox="0 0 640 340" role="group" aria-label={t("fpMap")} className="w-full">
              {map.states.map((s, i) => (
                <g key={`${s.code}-${i}`} aria-hidden>
                  <polygon points={s.d} className="fill-muted stroke-line-strong" strokeWidth="1.5" />
                  {s.main && (
                    <text
                      x={s.cx}
                      y={s.cy}
                      textAnchor="middle"
                      className="fill-ink-3 text-[12px] font-semibold tracking-wide"
                    >
                      {stateName(s.code, s.name)}
                    </text>
                  )}
                </g>
              ))}
              {map.pins.map(({ c, xy, home, label: l }) => {
                const only = c.fields.length === 1 ? c.fields[0]! : null;
                const on = filter === c.key;
                return (
                  <g
                    key={c.key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    aria-label={
                      only
                        ? f("pinLabelOne", { name: label(c), field: only.name, status: statusText(c.urgency) })
                        : f("pinLabel", { name: label(c), n: c.fields.length, status: statusText(c.urgency) })
                    }
                    onClick={() => setFilter(on ? null : c.key)}
                    onKeyDown={pinKey(c)}
                    className="group cursor-pointer outline-none"
                  >
                    {Math.hypot(xy[0] - home[0], xy[1] - home[1]) > 4 && (
                      <>
                        <line
                          x1={home[0]}
                          y1={home[1]}
                          x2={xy[0]}
                          y2={xy[1]}
                          className="stroke-ink-3"
                          strokeWidth="1.5"
                        />
                        <circle cx={home[0]} cy={home[1]} r={3} className="fill-ink-3" />
                      </>
                    )}
                    {/* 44 px touch target (the viewBox is scaled down on a phone, so the target is larger than the dot) */}
                    <circle cx={xy[0]} cy={xy[1]} r={22} className="fill-transparent" />
                    <circle
                      cx={xy[0]}
                      cy={xy[1]}
                      r={19}
                      fill="none"
                      strokeWidth="3"
                      className={`stroke-ink ${on ? "opacity-100" : "opacity-0 group-focus-visible:opacity-100"}`}
                    />
                    <circle
                      cx={xy[0]}
                      cy={xy[1]}
                      r={13}
                      className={`${PIN[c.urgency]} stroke-surface`}
                      strokeWidth="3"
                    />
                    <text
                      x={xy[0]}
                      y={xy[1] + 4}
                      textAnchor="middle"
                      className="fill-surface text-[12px] font-bold"
                    >
                      {c.fields.length}
                    </text>
                    <text x={l.x} y={l.y} textAnchor={l.anchor} className="fill-ink text-[12px]">
                      {l.text}
                    </text>
                  </g>
                );
              })}
            </svg>
            {map.states.length === 0 && <p className="text-small text-ink-2">{t("fpNoOutline")}</p>}
          </div>
          <div>
            <h2 className="mb-3 text-h2 text-ink">{f("mapTitle")}</h2>
            {(["urgent", "this_week", "all_good"] as const).map((u) => {
              const Icon = STATUS_ICON[u];
              return (
                <p key={u} className="flex items-center gap-2 text-small text-ink">
                  <span
                    aria-hidden
                    className={`size-3 rounded-chip ${u === "urgent" ? "bg-urgent" : u === "this_week" ? "bg-week" : "bg-ok"}`}
                  />
                  <Icon aria-hidden className="size-4" strokeWidth={1.7} />
                  {statusText(u)}
                </p>
              );
            })}
          </div>
        </Surface>
      )}

      {attention.length > 0 && (
        <section aria-label={f("needsYou")} className="flex flex-col gap-3">
          {attention.map(({ fl, c }) => (
            <FieldRow key={fl.fieldId} fl={fl} c={c} no={rowNo++} showRegion />
          ))}
        </section>
      )}
      {calm.map(({ c, fields }) => (
        <section key={c.key} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-x-2 text-h2 text-ink">
              <MapPin aria-hidden className="size-5" strokeWidth={1.7} />
              {label(c)}
              <span className="text-small font-normal text-ink-2">
                {fields.length} · {fmtFor(countryOf(c)).area(c.areaHa)}
                {c.weather && ` · ${t("fpToday", { t: weatherText(c) })}`}
              </span>
            </h2>
          </div>
          {fields.map((fl) => (
            <FieldRow key={fl.fieldId} fl={fl} c={c} no={rowNo++} />
          ))}
        </section>
      ))}
    </div>
  );

  function FieldRow({
    fl,
    c,
    no,
    showRegion,
  }: {
    fl: Row;
    c: FieldsOverviewData["counties"][number];
    no: number;
    showRegion?: boolean;
  }) {
    const cc = countryOf(c);
    const fmt = fmtFor(cc);
    const tier = tierOf(cc);
    const Icon = STATUS_ICON[fl.urgency];
    return (
      <Link
        href={`/fields/${fl.fieldId}`}
        style={{ "--i": no } as React.CSSProperties}
        className="stagger animate-rise focus-ring flex min-h-tap flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4 hover:bg-muted"
      >
        <FieldThumb name={fl.name} outline={fl.thumb ?? null} crop={fl.lastCropId ?? null} size={40} />
        <span className="min-w-48 flex-1">
          <span className="block text-body font-semibold text-ink">{fl.name}</span>
          <span className="block text-small text-ink-2">
            {[fl.lastCrop?.[locale], fmt.area(fl.areaHa), showRegion ? label(c) : null].filter(Boolean).join(" · ")}
          </span>
          <TrustLine compact dataLevel={tier} estimate={tier === "C"} className="!min-h-0" />
        </span>
        <span className="min-w-56 flex-1 text-small">
          {fl.next ? (
            <>
              <span className="block font-semibold text-ink">{fl.next.title[locale]}</span>
              {fl.next.deadline && (
                <span className={fl.urgency === "urgent" ? "text-urgent" : "text-ink-2"}>
                  {t("fpBy", { date: date(fl.next.deadline) })}
                </span>
              )}
            </>
          ) : (
            <span className="text-ink-2">{f("nothingWaiting")}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Chip tone={TONE[fl.urgency]} icon={<Icon />}>
            {statusText(fl.urgency)}
          </Chip>
          <LandChip status={fl.suitabilityStatus ?? null} overridden={fl.suitabilityOverridden ?? false} />
        </span>
        <ChevronRight aria-hidden className="size-5 text-ink-3" />
      </Link>
    );
  }
}
