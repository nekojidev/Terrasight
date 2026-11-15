"use client";

import { Chip, FieldThumb } from "@terrasight/ui";
import { ChevronRight, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { LandChip, type LandStatus } from "@/components/LandSuitability";

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

const AC = 2.471054;
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

/** Fields (design 07, S-04.08): county chips, a schematic map with one pin per county, the list grouped by county. */
export function FieldsOverview({
  data,
  units,
  canEdit,
}: {
  data: FieldsOverviewData;
  units: "metric" | "imperial";
  canEdit: boolean;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const [filter, setFilter] = useState<string | null>(null);
  const area = (ha: number) =>
    units === "imperial" ? `${Math.round(ha * AC).toLocaleString()} ac` : `${ha.toFixed(1)} ha`;
  const temp = (c: number | null) =>
    c === null ? "—" : units === "imperial" ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°`;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
    }).format(new Date(`${iso}T12:00:00Z`));
  const oblast = (state: string | null, fallback: string) =>
    locale === "uk" && state && UA_OBLAST[state]
      ? state === "UA-30" || state === "UA-40"
        ? UA_OBLAST[state]
        : `${UA_OBLAST[state]} обл.`
      : fallback;
  const label = (c: FieldsOverviewData["counties"][number]) =>
    countryOf(c) === "UA" ? oblast(c.state, c.county) : `${c.state?.split("-")[1] ?? ""} · ${c.county}`;
  const stateName = (code: string, name: string) => (code.startsWith("UA-") ? oblast(code, name) : name);
  const weatherText = (w: NonNullable<FieldsOverviewData["counties"][number]["weather"]>) =>
    [
      `${temp(w.tminC)} / ${temp(w.tmaxC)}`,
      w.precipMm == null
        ? null
        : w.precipMm < 0.2
          ? t("fpDry")
          : t("fpRain", {
              mm:
                units === "imperial" ? (w.precipMm / 25.4).toFixed(2) + " in" : `${w.precipMm.toFixed(1)} mm`,
            }),
    ]
      .filter(Boolean)
      .join(", ");
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
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1 text-ink">{t("fieldsTitle")}</h1>
          <p className="text-body text-ink-2">
            {t("fpSub", { n, c: data.counties.length, area: area(data.totalHa) })}
          </p>
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

      <div role="radiogroup" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={!filter}
          onClick={() => setFilter(null)}
          className={`focus-ring rounded-chip border px-4 py-2 text-small font-semibold ${!filter ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"}`}
        >
          {t("fpAll", { n })}
        </button>
        {data.counties.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={filter === c.key}
            onClick={() => setFilter(c.key)}
            className={`focus-ring rounded-chip border px-4 py-2 text-small font-semibold ${filter === c.key ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"}`}
          >
            {label(c)}
          </button>
        ))}
      </div>

      {map && (
        <section className="grid gap-6 rounded-card border border-line bg-surface p-6 lg:grid-cols-[1fr_260px]">
          <div>
            {countries.length > 1 && !filter && (
              <div role="tablist" className="mb-2 flex gap-2">
                {countries.map((cc) => (
                  <button
                    key={cc}
                    type="button"
                    role="tab"
                    aria-selected={cc === activeCountry}
                    onClick={() => setMapCountry(cc)}
                    className={`focus-ring rounded-chip border px-3 py-1 text-small font-semibold ${cc === activeCountry ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"}`}
                  >
                    {cc === "UA" ? t("fpUkraine") : cc === "US" ? t("fpUsa") : cc}
                  </button>
                ))}
              </div>
            )}
            <svg viewBox="0 0 640 340" role="img" aria-label={t("fpMap")} className="w-full">
              {map.states.map((s, i) => (
                <g key={`${s.code}-${i}`}>
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
              {map.pins.map(({ c, xy, home, label: l }) => (
                <g
                  key={c.key}
                  onClick={() => setFilter(filter === c.key ? null : c.key)}
                  className="cursor-pointer"
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
              ))}
            </svg>
            {map.states.length === 0 && <p className="text-small text-ink-2">{t("fpNoOutline")}</p>}
          </div>
          <div>
            <h2 className="text-h2 text-ink">{t("fpMap")}</h2>
            <p className="mb-3 text-small text-ink-2">{t("fpMapSub")}</p>
            {(["urgent", "this_week", "all_good"] as const).map((u) => (
              <p key={u} className="flex items-center gap-2 text-small text-ink">
                <span
                  aria-hidden
                  className={`size-3 rounded-chip ${u === "urgent" ? "bg-urgent" : u === "this_week" ? "bg-week" : "bg-ok"}`}
                />
                {t(u === "urgent" ? "fpUrgent" : u === "this_week" ? "fpWeek" : "fpOk")}
              </p>
            ))}
          </div>
        </section>
      )}

      {shown.map((c) => (
        <section key={c.key} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-h2 text-ink">
              <MapPin aria-hidden className="size-5" strokeWidth={1.7} />
              {label(c)}
              <span className="text-small font-normal text-ink-2">
                {c.fields.length} · {area(c.areaHa)}
              </span>
            </h2>
            {c.weather && <Chip tone="neutral">{t("fpToday", { t: weatherText(c.weather) })}</Chip>}
          </div>
          {c.fields.map((f) => (
            <Link
              key={f.fieldId}
              href={`/fields/${f.fieldId}`}
              className="focus-ring flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4 hover:bg-muted"
            >
              <FieldThumb name={f.name} outline={f.thumb ?? null} crop={f.lastCropId ?? null} size={40} />
              <span className="min-w-48 flex-1">
                <span className="block text-body font-semibold text-ink">{f.name}</span>
                <span className="text-small text-ink-2">
                  {[f.lastCrop?.[locale], area(f.areaHa)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="min-w-64 flex-1 text-small">
                {f.next ? (
                  <>
                    <span className="block font-semibold text-ink">{f.next.title[locale]}</span>
                    {f.next.deadline && (
                      <span
                        className={
                          TONE[f.urgency] === "urgent"
                            ? "text-urgent"
                            : TONE[f.urgency] === "week"
                              ? "text-week"
                              : "text-ink-2"
                        }
                      >
                        {t("fpBy", { date: date(f.next.deadline) })}
                      </span>
                    )}
                    {f.next.more > 0 && (
                      <span className="ml-2 text-ink-2">{t("more", { n: f.next.more })}</span>
                    )}
                  </>
                ) : (
                  <span className="text-ink-2">{t("fpNothing")}</span>
                )}
              </span>
              <LandChip status={f.suitabilityStatus} overridden={f.suitabilityOverridden} />
              <Chip tone={TONE[f.urgency]}>
                {t(f.urgency === "urgent" ? "fpUrgent" : f.urgency === "this_week" ? "fpWeek" : "fpOk")}
              </Chip>
              <ChevronRight aria-hidden className="size-5 text-ink-3" />
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}
