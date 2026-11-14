"use client";

import { Chip, FieldThumb } from "@terrasight/ui";
import { ChevronRight, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

type Localised = { en: string; uk: string };
type Urgency = "urgent" | "this_week" | "all_good";
interface Row {
  fieldId: string;
  name: string;
  areaHa: number;
  lastCrop: Localised | null;
  lastCropId?: string | null;
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
    weather: { tminC: number | null; tmaxC: number | null } | null;
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
  const label = (c: FieldsOverviewData["counties"][number]) =>
    `${c.state?.split("-")[1] ?? ""} · ${c.county}`;
  const n = data.counties.reduce((s, c) => s + c.fields.length, 0);

  // Project state outlines and county pins into the map box (equirectangular, scaled by cos(lat)).
  const map = useMemo(() => {
    const rings = data.states.flatMap((s) =>
      s.geometry.type === "MultiPolygon"
        ? (s.geometry.coordinates as number[][][][]).map((p) => ({ code: s.code, name: s.name, ring: p[0]! }))
        : [{ code: s.code, name: s.name, ring: (s.geometry.coordinates as number[][][])[0]! }],
    );
    const pts = [...rings.flatMap((r) => r.ring), ...data.counties.map((c) => [c.lon, c.lat])];
    if (!pts.length) return null;
    const lons = pts.map((p) => p[0]!);
    const lats = pts.map((p) => p[1]!);
    const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const s = Math.min(600 / Math.max((x1 - x0) * k, 1e-6), 300 / Math.max(y1 - y0, 1e-6));
    const P = (lon: number, lat: number) => [20 + (lon - x0) * k * s, 320 - (lat - y0) * s] as const;
    return {
      states: rings.map((r) => {
        const xy = r.ring.map(([lon, lat]) => P(lon!, lat!));
        const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length;
        const cy = xy.reduce((a, p) => a + p[1], 0) / xy.length;
        return { code: r.code, name: r.name, d: xy.map((p) => p.join(",")).join(" "), cx, cy };
      }),
      pins: data.counties.map((c) => ({ c, xy: P(c.lon, c.lat) })),
    };
  }, [data]);

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
          <svg viewBox="0 0 640 340" role="img" aria-label={t("fpMap")} className="w-full">
            {map.states.map((s, i) => (
              <g key={`${s.code}-${i}`}>
                <polygon points={s.d} className="fill-muted stroke-line-strong" strokeWidth="1.5" />
                <text
                  x={s.cx}
                  y={s.cy}
                  textAnchor="middle"
                  className="fill-ink-3 text-[14px] font-semibold tracking-wide"
                >
                  {s.name}
                </text>
              </g>
            ))}
            {map.pins.map(({ c, xy }) => (
              <g
                key={c.key}
                onClick={() => setFilter(filter === c.key ? null : c.key)}
                className="cursor-pointer"
              >
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
                <text x={xy[0] + 18} y={xy[1] + 4} className="fill-ink text-[13px]">
                  {c.county.replace(/ County$/, "")}
                </text>
              </g>
            ))}
          </svg>
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
            {c.weather && (
              <Chip tone="neutral">
                {t("fpToday", { t: `${temp(c.weather.tminC)} / ${temp(c.weather.tmaxC)}` })}
              </Chip>
            )}
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
