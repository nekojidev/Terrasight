/**
 * Field history from cached source results (RFC D3, §6.1–§6.3). Pure functions: no I/O, tested directly.
 * Thresholds marked "calibrate" are working values for the hackathon, to be checked against real fields.
 */
import type { Library, Rotation, SequenceItem } from "@terrasight/library";
import {
  cdlCrop,
  type CdlHistory,
  type DailyWeather,
  type EtSeries,
  type NdviSeries,
  type SoilSummary,
} from "@terrasight/sources";

export const HISTORY_SEASONS = 18;
/** NDVI below this is bare soil (calibrate). */
export const BARE_NDVI = 0.2;
/** A CDL majority at or above this share is high confidence (RFC §6.1). */
export const CDL_HIGH_CONFIDENCE = 0.7;
/** A baseline rotation is the current one when it matches at least this share of years (RFC §6.3). */
export const BASELINE_MATCH = 0.75;

export interface SeasonCrop {
  season: number;
  mainCrop: string;
  secondCrop: string | null;
  confidence: number;
  source: "cdl" | "ndvi";
}

// ---------- crops per season ----------

export function cropsFromCdl(cdl: CdlHistory, regionId: string | null): SeasonCrop[] {
  return cdl.seasons.map((s) => {
    const crop = cdlCrop(s.majorityCode, regionId);
    const main = crop === null ? `other:${s.majorityCode}` : typeof crop === "string" ? crop : crop.main;
    const second = crop !== null && typeof crop === "object" ? crop.second : null;
    return { season: s.year, mainCrop: main, secondCrop: second, confidence: s.majorityShare, source: "cdl" };
  });
}

type CropGroup = "winter" | "summer" | "fallow" | "perennial";

/**
 * Tier C classifier (RFC §6.1): crop group from the shape of the season's NDVI curve.
 * Winter cereal / rapeseed: peak in April–May; summer row crop: peak in July–August; perennial: green most of
 * the year with dips (cuttings); fallow: never above the crop threshold. Northern hemisphere months.
 */
export function classifySeason(points: Array<{ date: string; ndvi: number }>): CropGroup | null {
  if (points.length < 10) return null;
  const month = (d: string) => Number(d.slice(5, 7));
  const peak = points.reduce((a, b) => (b.ndvi > a.ndvi ? b : a));
  if (peak.ndvi < 0.4) return "fallow"; // calibrate
  const greenShare = points.filter((p) => p.ndvi >= 0.45).length / points.length;
  if (greenShare >= 0.6) return "perennial";
  const m = month(peak.date);
  if (m >= 3 && m <= 6) return "winter";
  if (m >= 7 && m <= 9) return "summer";
  return null;
}

/** Maps a crop group to a crop using the region's baseline rotations (RFC §6.1: "chosen by the regional baseline"). */
export function cropForGroup(group: CropGroup, baselineCrops: string[]): string {
  const pick = (candidates: string[], fallback: string) =>
    candidates.find((c) => baselineCrops.includes(c)) ?? fallback;
  if (group === "fallow") return "fallow";
  if (group === "perennial") return pick(["alfalfa", "clover", "clover_grass"], "alfalfa");
  if (group === "winter")
    return pick(["winter_wheat", "winter_barley", "winter_canola", "winter_rye"], "winter_wheat");
  return pick(["corn", "sunflower", "soybean", "sorghum"], "corn");
}

export function cropsFromNdvi(series: NdviSeries, baselineCrops: string[], lastSeason: number): SeasonCrop[] {
  const out: SeasonCrop[] = [];
  for (let y = lastSeason - HISTORY_SEASONS + 1; y <= lastSeason; y++) {
    const pts = series.points.filter((p) => p.date.startsWith(String(y)));
    const group = classifySeason(pts);
    if (!group) continue;
    out.push({
      season: y,
      mainCrop: cropForGroup(group, baselineCrops),
      secondCrop: null,
      confidence: 0.5,
      source: "ndvi",
    });
  }
  return out;
}

// ---------- bare months, stress years ----------

/** Months (YYYY-MM) of the last seasons whose mean NDVI is below the bare-soil threshold. */
export function bareMonths(series: NdviSeries, fromYear: number): string[] {
  const byMonth = new Map<string, number[]>();
  for (const p of series.points) {
    if (Number(p.date.slice(0, 4)) < fromYear) continue;
    const k = p.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), p.ndvi]);
  }
  return [...byMonth.entries()]
    .filter(([, v]) => v.reduce((a, b) => a + b, 0) / v.length < BARE_NDVI)
    .map(([k]) => k)
    .sort();
}

export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export interface SeasonStats {
  season: number;
  precipMm: number | null;
  heatDays: number | null;
  ndviPeak: number | null;
}

export interface StressYear {
  season: number;
  reasons: Array<"low_ndvi" | "dry" | "hot">;
  stats: SeasonStats;
}

/** Days with Tmax above 35 °C count as heat days (calibrate per crop later). */
const HEAT_C = 35;

export function seasonStats(
  weather: DailyWeather | null,
  ndvi: NdviSeries | null,
  seasons: number[],
): SeasonStats[] {
  return seasons.map((season) => {
    let precip: number | null = null;
    let heat: number | null = null;
    if (weather) {
      const idx = weather.dates.map((d, i) => (d.startsWith(String(season)) ? i : -1)).filter((i) => i >= 0);
      if (idx.length >= 360) {
        precip = Math.round(idx.reduce((s, i) => s + (weather.values.PRECTOTCORR[i] ?? 0), 0));
        heat = idx.filter((i) => (weather.values.T2M_MAX[i] ?? -99) > HEAT_C).length;
      }
    }
    const pts = ndvi?.points.filter((p) => p.date.startsWith(String(season))) ?? [];
    const peak = pts.length ? Math.max(...pts.map((p) => p.ndvi)) : null;
    return { season, precipMm: precip, heatDays: heat, ndviPeak: peak };
  });
}

/** Seasons where NDVI peak or precipitation is below the field's 10th percentile, or heat above the 90th. */
export function stressYears(stats: SeasonStats[]): StressYear[] {
  const vals = (k: keyof SeasonStats) => stats.map((s) => s[k]).filter((v): v is number => v !== null);
  const pNdvi = percentile(vals("ndviPeak"), 0.1);
  const pDry = percentile(vals("precipMm"), 0.1);
  const pHot = percentile(vals("heatDays"), 0.9);
  return stats
    .map((s) => {
      const reasons: StressYear["reasons"] = [];
      if (s.ndviPeak !== null && s.ndviPeak <= pNdvi) reasons.push("low_ndvi");
      if (s.precipMm !== null && s.precipMm <= pDry) reasons.push("dry");
      if (s.heatDays !== null && s.heatDays >= pHot && s.heatDays > 0) reasons.push("hot");
      return { season: s.season, reasons, stats: s };
    })
    .filter((s) => s.reasons.length > 0);
}

// ---------- irrigation (RFC §6.2) ----------

export interface IrrigationDetection {
  status: "irrigated" | "dryland" | "unknown";
  /** 0–1: share of years that agree. */
  confidence: number;
  method: "openet" | "ndvi" | "none";
  evidence: Array<{
    season: number;
    etMm?: number;
    precipMm?: number;
    storageMm?: number;
    summerNdvi?: number;
  }>;
}

/** Below this agreement the agronomist is asked directly (RFC §6.2). */
export const IRRIGATION_CONFIDENT = 0.7;

export function detectIrrigation(
  et: EtSeries | null,
  stats: SeasonStats[],
  soil: SoilSummary | null,
  ndvi: NdviSeries | null,
): IrrigationDetection {
  const precip = new Map(stats.map((s) => [s.season, s.precipMm]));
  if (et?.annual.length) {
    // ET clearly above rain + soil storage means water came from somewhere else (US, RFC §6.2). Storage is the
    // root zone (0–100 cm): the full 0–150 cm profile can't be drawn down and refilled every season.
    const storage = soil?.aws100Mm ?? (soil?.awsMm != null ? (soil.awsMm * 2) / 3 : 150);
    const evidence = et.annual
      .filter((y) => precip.get(y.year) !== null && precip.get(y.year) !== undefined)
      .map((y) => ({
        season: y.year,
        etMm: y.etMm,
        precipMm: precip.get(y.year)!,
        storageMm: Math.round(storage),
      }));
    if (evidence.length >= 3) {
      const above =
        evidence.filter((e) => e.etMm > (e.precipMm + e.storageMm) * 1.1).length / evidence.length;
      const status = above >= 0.5 ? "irrigated" : "dryland";
      const confidence = status === "irrigated" ? above : 1 - above;
      return {
        status: confidence >= IRRIGATION_CONFIDENT ? status : "unknown",
        confidence: round2(confidence),
        method: "openet",
        evidence,
      };
    }
  }
  if (ndvi && stats.length) {
    // Elsewhere: NDVI stays high through dry summers → irrigated (RFC §6.2).
    const pDry = percentile(
      stats.map((s) => s.precipMm).filter((v): v is number => v !== null),
      0.35,
    );
    const dry = stats.filter((s) => s.precipMm !== null && s.precipMm <= pDry);
    const evidence = dry.map((s) => {
      const summer = ndvi.points.filter(
        (p) => p.date.startsWith(String(s.season)) && ["07", "08"].includes(p.date.slice(5, 7)),
      );
      return {
        season: s.season,
        precipMm: s.precipMm!,
        summerNdvi: summer.length ? round2(Math.max(...summer.map((p) => p.ndvi))) : undefined,
      };
    });
    const known = evidence.filter((e) => e.summerNdvi !== undefined);
    if (known.length >= 3) {
      const green = known.filter((e) => e.summerNdvi! >= 0.6).length / known.length; // calibrate
      const status = green >= 0.5 ? "irrigated" : "dryland";
      const confidence = status === "irrigated" ? green : 1 - green;
      return {
        status: confidence >= IRRIGATION_CONFIDENT ? status : "unknown",
        confidence: round2(confidence),
        method: "ndvi",
        evidence: known,
      };
    }
  }
  return { status: "unknown", confidence: 0, method: "none", evidence: [] };
}

// ---------- current rotation (RFC §6.3) ----------

export interface BaselineMatch {
  rotationId: string | null;
  label: "baseline" | "detected";
  share: number;
  /** Crops of the seasons used, oldest first. */
  detected: string[];
}

function itemKey(item: SequenceItem | { main: string; second: string | null }): string {
  if (typeof item === "string") return item;
  return item.second ? `${item.main}+${item.second}` : item.main;
}

export function matchBaseline(crops: SeasonCrop[], lib: Library, regionId: string | null): BaselineMatch {
  const recent = [...crops].sort((a, b) => a.season - b.season).slice(-6);
  const detected = recent.map((c) => itemKey({ main: c.mainCrop, second: c.secondCrop }));
  if (!regionId || recent.length < 4) return { rotationId: null, label: "detected", share: 0, detected };
  const baselines = lib.rotations.rotations.filter((r: Rotation) => r.region === regionId && r.baseline);
  let best: { id: string; share: number } | null = null;
  for (const r of baselines) {
    const seq = r.sequence.map(itemKey);
    for (let shift = 0; shift < seq.length; shift++) {
      // Double-crop seasons match only when both crops match (RFC §6.3).
      const hits = detected.filter((d, i) => seq[(i + shift) % seq.length] === d).length;
      const share = hits / detected.length;
      if (!best || share > best.share) best = { id: r.id, share };
    }
  }
  if (best && best.share >= BASELINE_MATCH)
    return { rotationId: best.id, label: "baseline", share: round2(best.share), detected };
  return { rotationId: null, label: "detected", share: round2(best?.share ?? 0), detected };
}

export function baselineCrops(lib: Library, regionId: string | null): string[] {
  if (!regionId) return [];
  return lib.rotations.rotations
    .filter((r) => r.region === regionId && r.baseline)
    .flatMap((r) => r.sequence.flatMap((i) => (typeof i === "string" ? [i] : [i.main, i.second])));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
