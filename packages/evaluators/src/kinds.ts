import type { ModelNode } from "@terrasight/library";
import type { DailyWeather, EvalInputs, Level, NodeResult } from "./types.js";

/** Resolves `{ ref: "name" }` (or a literal number) to a threshold value; null when missing. */
export type Resolve = (param: unknown) => number | null;

const ORDER: Record<Exclude<Level, "unknown">, number> = { none: 0, low: 1, moderate: 2, high: 3 };
const WHEAT = new Set(["winter_wheat", "spring_wheat", "durum_wheat"]);
/** A crop row counts as estimated below this CDL / NDVI agreement (RFC §6.1: high when ≥ 70 % of the field). */
const CONFIRMED_CROP = 0.7;
/** Past years needed before a percentile means anything. */
const MIN_CLIMATE_YEARS = 10;

export const empty = (level: Level): NodeResult => ({
  level,
  numbers: {},
  drivers: [],
  evidence: [],
  unknowns: [],
  estimated: [],
});
const unknown = (why: string): NodeResult => ({ ...empty("unknown"), unknowns: [why] });

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(day(iso) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000);
const tmean = (w: DailyWeather) =>
  w.tmeanC ?? (w.tminC !== null && w.tmaxC !== null ? (w.tminC + w.tmaxC) / 2 : null);

// ---------- leaves ----------

/** Host crop in the previous seasons in a row, and whether the next season repeats it (RFC §11.2). */
export function hostRepeat(node: Record<string, unknown>, inp: EvalInputs, resolve: Resolve): NodeResult {
  const hosts = new Set((node.host as string[] | undefined) ?? []);
  const needed = resolve(node.seasons);
  if (needed === null) return unknown("threshold seasons is missing");
  const isHost = (c: { mainCrop: string; secondCrop: string | null }) =>
    hosts.has(c.mainCrop) || (c.secondCrop !== null && hosts.has(c.secondCrop));
  const past = [...inp.crops]
    .filter((c) => c.season < inp.nextCrop.season)
    .sort((a, b) => b.season - a.season);
  if (!past.length) return unknown("no crop history");
  const r = empty("low");
  let inRow = 0;
  const counted: number[] = [];
  for (const c of past) {
    if (c.season !== past[0]!.season - inRow || !isHost(c)) break;
    inRow += 1;
    counted.push(c.season);
    if (!c.isOverride && c.confidence < CONFIRMED_CROP) r.estimated.push(`crop in ${c.season} not confirmed`);
  }
  const gap = inp.nextCrop.season - 1 - past[0]!.season;
  if (gap > 0)
    r.unknowns.push(
      `crop for ${past[0]!.season + 1}${gap > 1 ? `–${inp.nextCrop.season - 1}` : ""} not known yet`,
    );
  const next = inp.nextCrop.crop;
  const nextIsHost = next !== null && hosts.has(next);
  r.numbers.hostSeasonsInRow = { value: inRow, unit: "seasons" };
  r.numbers.hostSeasonsInPlan = { value: nextIsHost ? 1 : 0, unit: "seasons" };
  r.drivers.push({ driver: "rotation", value: inRow, unit: "seasons", fired: inRow >= needed });
  r.evidence.push({
    source: "Crop history",
    from: String(Math.min(...(counted.length ? counted : [past[0]!.season]))),
    to: String(past[0]!.season),
    value: inRow,
    unit: "host seasons in a row",
  });
  if (inRow >= needed) {
    r.level = nextIsHost ? "high" : next === null ? "moderate" : "low";
    if (next === null) r.unknowns.push(`crop for ${inp.nextCrop.season} not chosen yet`);
  }
  return r;
}

/** Degree days from a biofix with stage thresholds; forecast days extend the projection (RFC §11.2). */
export function degreeDays(
  node: Record<string, unknown>,
  inp: EvalInputs,
  resolve: Resolve,
  asOf: string,
): NodeResult {
  const base = resolve(node.baseC);
  if (base === null) return unknown("threshold baseC is missing");
  const stages = Object.entries((node.stages as Record<string, unknown>) ?? {}).map(([name, v]) => ({
    name,
    dd: resolve(v),
  }));
  if (!stages.length || stages.some((s) => s.dd === null))
    return unknown("a degree-day stage threshold is missing");
  const r = empty("low");
  let biofix: string | null = null;
  if (node.biofix === "jan1") biofix = `${asOf.slice(0, 4)}-01-01`;
  else if (node.biofix === "emergence") {
    const e = inp.record.emergenceDate;
    if (e.value) {
      biofix = e.value;
      if (e.source !== "confirmed") r.estimated.push("emergence date estimated");
    } else return unknown("emergence date is missing");
  } else if (typeof node.biofix === "string" && /^\d{4}-\d{2}-\d{2}$/.test(node.biofix)) biofix = node.biofix;
  if (!biofix) return unknown("biofix is not set");
  if (biofix > asOf) return { ...empty("none"), numbers: { degreeDays: { value: 0, unit: "°C·d" } } };

  const soil = node.temp === "soil";
  const temp = (w: DailyWeather) => (soil ? (w.soilC ?? null) : tmean(w));
  let observed = 0;
  let projected = 0;
  let missing = 0;
  let lastForecastDay = 0;
  const horizon = 7; // evaluators use forecast days 1–7 only (RFC §13)
  for (const w of inp.weather) {
    if (w.date < biofix) continue;
    const t = temp(w);
    if (w.origin === "forecast") {
      if (w.date <= asOf || (w.forecastDay ?? 99) > horizon) continue;
      if (t !== null) {
        projected += Math.max(0, t - base);
        lastForecastDay = Math.max(lastForecastDay, w.forecastDay ?? 0);
      }
      continue;
    }
    if (w.date > asOf) continue;
    if (t === null) missing += 1;
    else observed += Math.max(0, t - base);
  }
  const span = daysBetween(biofix, asOf) + 1;
  if (missing > span * 0.2)
    return unknown(`${soil ? "soil" : "air"} temperature missing for ${missing} of ${span} days`);
  if (missing) r.unknowns.push(`${missing} days without temperature`);
  const sorted = [...stages].sort((a, b) => a.dd! - b.dd!);
  const now = Math.round(observed);
  const ahead = Math.round(observed + projected);
  r.numbers.degreeDays = { value: now, unit: "°C·d" };
  r.numbers.degreeDaysIn7Days = { value: ahead, unit: "°C·d" };
  r.numbers.daysSinceEmergence = {
    value: node.biofix === "emergence" ? daysBetween(biofix, asOf) : "—",
    unit: "days",
  };
  const top = sorted.at(-1)!;
  const first = sorted[0]!;
  r.drivers.push({ driver: "degree_days", value: now, unit: "°C·d", fired: now >= first.dd! });
  r.evidence.push({
    source: `NASA POWER + Open-Meteo, ${soil ? "soil" : "air"} temperature, base ${base} °C`,
    from: biofix,
    to: asOf,
    value: now,
    unit: "°C·d",
  });
  if (now >= top.dd!) r.level = "high";
  else if (now >= first.dd!) r.level = "moderate";
  else if (ahead >= first.dd!) {
    r.level = "moderate";
    r.forecastDayUsed = lastForecastDay;
  }
  return r;
}

/** Season window for an anomaly: autumn = 1 Sep (1 Mar south) → asOf. */
function windowStart(window: unknown, asOf: string, south: boolean): string | null {
  if (window !== "autumn") return null;
  const y = Number(asOf.slice(0, 4));
  const start = south ? `${y}-03-01` : `${y}-09-01`;
  return start <= asOf ? start : null;
}

/** This season against the field's own 1981+ distribution, as a percentile (RFC §11.2). */
export function climateAnomaly(
  node: Record<string, unknown>,
  inp: EvalInputs,
  resolve: Resolve,
  asOf: string,
): NodeResult {
  const pct = resolve(node.percentile);
  if (pct === null) return unknown("threshold percentile is missing");
  if (node.variable !== "air_temp_mean") return unknown(`variable ${String(node.variable)} not supported`);
  const start = windowStart(node.window, asOf, inp.southernHemisphere ?? false);
  if (!start) return { ...empty("none"), unknowns: [`outside the ${String(node.window)} window`] };
  const offsetStart = daysBetween(`${start.slice(0, 4)}-01-01`, start);
  const length = daysBetween(start, asOf) + 1;
  const byYear = new Map<number, number[]>();
  for (const w of inp.weather) {
    if (w.origin === "forecast") continue;
    const y = Number(w.date.slice(0, 4));
    const s = addDays(`${y}-01-01`, offsetStart);
    const d = daysBetween(s, w.date);
    if (d < 0 || d >= length) continue;
    const t = tmean(w);
    if (t === null) continue;
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(t);
  }
  const thisYear = Number(asOf.slice(0, 4));
  const current = byYear.get(thisYear);
  if (!current || current.length < length * 0.8)
    return unknown("not enough temperature data for this season");
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const past = [...byYear.entries()]
    .filter(([y, xs]) => y < thisYear && xs.length >= length * 0.8)
    .map(([, xs]) => mean(xs));
  if (past.length < MIN_CLIMATE_YEARS) return unknown(`only ${past.length} past years of temperature`);
  const m = mean(current);
  const percentile = Math.round((past.filter((p) => p < m).length / past.length) * 100);
  const r = empty(percentile >= pct ? "high" : "low");
  r.numbers.autumnPercentile = { value: percentile, unit: "percentile" };
  r.numbers.autumnMeanC = { value: Math.round(m * 10) / 10, unit: "°C" };
  r.drivers.push({ driver: "temperature", value: percentile, unit: "percentile", fired: percentile >= pct });
  r.evidence.push({
    source: `NASA POWER daily mean air temperature vs ${past.length} past years`,
    from: start,
    to: asOf,
    value: Math.round(m * 10) / 10,
    unit: "°C",
  });
  return r;
}

/** Green vegetation between the previous wheat harvest and sowing: volunteer wheat (RFC §11.2, v2.1). */
export function greenBridge(
  node: Record<string, unknown>,
  inp: EvalInputs,
  resolve: Resolve,
  asOf: string,
): NodeResult {
  const green = resolve(node.greenNdvi);
  const buffer = resolve(node.bufferM);
  if (green === null || buffer === null) return unknown("threshold greenNdvi or bufferM is missing");
  const prev = [...inp.crops].filter((c) => c.season < inp.season).sort((a, b) => b.season - a.season)[0];
  if (!prev) return unknown("no crop history");
  const r = empty("low");
  const wasWheat = WHEAT.has(prev.mainCrop) || (prev.secondCrop !== null && WHEAT.has(prev.secondCrop));
  r.drivers.push({ driver: "previous_crop", value: prev.mainCrop, fired: wasWheat });
  if (!wasWheat) return r;
  if (!prev.isOverride && prev.confidence < CONFIRMED_CROP)
    r.estimated.push(`crop in ${prev.season} not confirmed`);
  // Harvest date isn't observed: winter wheat in the plains is cut by early July (estimate, listed below).
  const harvest = `${prev.season}-07-01`;
  r.estimated.push("previous harvest date estimated (1 July)");
  const sowing = inp.record.sowingDate;
  const end = sowing.value && sowing.value <= asOf ? sowing.value : asOf;
  if (sowing.value && sowing.source !== "confirmed") r.estimated.push("sowing date estimated");
  const obs = inp.ndvi.filter((o) => o.date >= harvest && o.date <= end);
  r.unknowns.push("Volunteer patches smaller than 10 m may not show in Sentinel-2 NDVI");
  r.unknowns.push(`Neighbouring land within ${buffer} m is not checked`);
  if (!obs.length)
    return {
      ...r,
      level: "unknown",
      unknowns: [...r.unknowns, "no Sentinel-2 images between harvest and sowing"],
    };
  const greenObs = obs.filter((o) => o.mean >= green);
  const firstGreen = greenObs[0]?.date;
  r.numbers.greenDaysBeforeSowing = { value: firstGreen ? daysBetween(firstGreen, end) : 0, unit: "days" };
  r.numbers.sowingDate = { value: sowing.value ?? "—" };
  r.drivers.push({
    driver: "green_bridge",
    value: greenObs.length,
    unit: "images",
    fired: greenObs.length > 0,
  });
  r.evidence.push({
    source: "Copernicus Sentinel-2 NDVI (10 m)",
    from: harvest,
    to: end,
    value: Math.max(...obs.map((o) => o.mean)),
    unit: "max NDVI",
  });
  if (greenObs.length) r.level = "high";
  return r;
}

// ---------- tree ----------

/** Evaluates a model tree: leaves by kind, then `all` / `any` / `max` / `gate` (RFC §11.2). */
export function evalNode(node: ModelNode, inp: EvalInputs, resolve: Resolve, asOf: string): NodeResult {
  if ("kind" in node) {
    switch (node.kind) {
      case "host_repeat":
        return hostRepeat(node, inp, resolve);
      case "degree_days":
        return degreeDays(node, inp, resolve, asOf);
      case "climate_anomaly":
        return climateAnomaly(node, inp, resolve, asOf);
      case "green_bridge":
        return greenBridge(node, inp, resolve, asOf);
      default:
        // host_interval, weather_window, water_stress: after the hackathon.
        return unknown(`evaluator ${node.kind} is not implemented yet`);
    }
  }
  if ("gate" in node) {
    const [cond, then] = node.gate;
    const a = evalNode(cond, inp, resolve, asOf);
    if (a.level === "unknown" || a.level === "none" || a.level === "low") return a;
    const b = evalNode(then, inp, resolve, asOf);
    return merge([a, b], b.level);
  }
  const children = ("all" in node ? node.all : "any" in node ? node.any : node.max).map((c) =>
    evalNode(c, inp, resolve, asOf),
  );
  return merge(
    children,
    combine(
      "all" in node ? "all" : "max",
      children.map((c) => c.level),
    ),
  );
}

/**
 * `all`: the weakest child decides; a known low/none child settles it, otherwise any unknown makes it unknown.
 * `any` / `max`: the strongest child; unknown wins unless a known child is already high. Unknown never becomes low.
 */
export function combine(op: "all" | "max", levels: Level[]): Level {
  const known = levels.filter((l): l is Exclude<Level, "unknown"> => l !== "unknown");
  const hasUnknown = known.length < levels.length;
  if (op === "all") {
    if (!known.length) return "unknown";
    const min = known.reduce((a, b) => (ORDER[b] < ORDER[a] ? b : a));
    if (ORDER[min] <= ORDER.low) return min;
    return hasUnknown ? "unknown" : min;
  }
  if (!known.length) return "unknown";
  const max = known.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a));
  return hasUnknown && max !== "high" ? "unknown" : max;
}

function merge(parts: NodeResult[], level: Level): NodeResult {
  const out = empty(level);
  for (const p of parts) {
    Object.assign(out.numbers, p.numbers);
    out.drivers.push(...p.drivers);
    out.evidence.push(...p.evidence);
    for (const u of p.unknowns) if (!out.unknowns.includes(u)) out.unknowns.push(u);
    for (const e of p.estimated) if (!out.estimated.includes(e)) out.estimated.push(e);
    if (p.forecastDayUsed) out.forecastDayUsed = Math.max(out.forecastDayUsed ?? 0, p.forecastDayUsed);
  }
  return out;
}
