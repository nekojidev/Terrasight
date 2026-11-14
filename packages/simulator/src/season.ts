import { BARE_C, CROPS, FALLOW_KC, kcOnDay, rootDepthOnDay, seasonLength, type CropParams } from "./crops.js";
import { dayOfYear, et0Hargreaves, et0PenmanMonteith } from "./et0.js";
import { curveNumber, scsRunoff, type HydGroup } from "./soil.js";

/** One day of weather for the simulator (NASA POWER daily, already resampled for the run). */
export interface WeatherDay {
  date: string;
  tmin: number;
  tmax: number;
  precip: number;
  rh?: number | null;
  /** Solar radiation, MJ m⁻² day⁻¹. */
  rs?: number | null;
  /** Wind at 2 m, m/s. */
  u2?: number | null;
  /** Precomputed ET₀, mm (the engine computes it once per weather day; ignored when climate deltas apply). */
  et0?: number;
}

export interface Site {
  latDeg: number;
  elevationM: number;
  /** Plant-available water per metre of soil, mm/m (SSURGO AWS 0–100 cm ÷ 1 m, or SoilGrids). */
  awsMmPerM: number;
  hydGroup: HydGroup | null;
  slopePct: number;
}

export interface CropRun {
  crop: string;
  /** Sowing date, ISO. */
  sowing: string;
}

export interface SeasonInput {
  site: Site;
  /** One or two crops in this season, in order (double cropping, RFC §7.8). Empty = fallow season. */
  crops: CropRun[];
  irrigated: boolean;
  /** Seasonal irrigation cap, mm (water cap, RFC §7.6); undefined = no cap. */
  waterCapMm?: number;
  /** Root-zone depletion at the start, mm (carried over from the previous season). */
  startDepletionMm: number;
  /** Climate deltas (sliders, RFC §7.3). */
  deltaT?: number;
  precipFactor?: number;
}

export interface CropResult {
  crop: string;
  sowing: string;
  harvest: string;
  etcMm: number;
  etaMm: number;
  irrigationMm: number;
  /** Ya / Ym from FAO-33: 1 − Ky (1 − ETa/ETc). */
  yieldRatio: number;
  /** Irrigation the crop would have used without a cap (to report "exceeds cap"). */
  uncappedIrrigationMm: number;
  capped: boolean;
}

export interface SeasonResult {
  crops: CropResult[];
  precipMm: number;
  runoffMm: number;
  drainageMm: number;
  irrigationMm: number;
  /** Actual ET over every day of the season, crops and bare soil. */
  etaTotalMm: number;
  endDepletionMm: number;
  /** Days with no crop on the field. */
  bareDays: number;
  /** Mean RUSLE C over the season's days. */
  meanC: number;
  days: number;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function et0(day: WeatherDay, site: Site, dT: number): number {
  if (day.et0 !== undefined && dT === 0) return day.et0;
  const doy = dayOfYear(day.date);
  const tmin = day.tmin + dT;
  const tmax = day.tmax + dT;
  if (day.rs != null && day.u2 != null && day.rh != null) {
    return et0PenmanMonteith({
      tmin,
      tmax,
      rhMean: day.rh,
      rs: day.rs,
      u2: day.u2,
      elevationM: site.elevationM,
      latDeg: site.latDeg,
      doy,
    });
  }
  return et0Hargreaves(tmin, tmax, site.latDeg, doy);
}

/**
 * One season, daily (FAO-56 Chapter 8, single crop coefficient): ETc = Kc·ET₀, root-zone depletion Dr with
 * TAW = AWS·Zr and RAW = p·TAW, Ks below RAW, SCS-CN runoff, deep percolation above field capacity; irrigated fields
 * refill to field capacity when Dr reaches RAW, within the seasonal cap. Yield ratio per crop from FAO-33.
 * The weather array covers the season (from the first sowing to a year later); days outside crops are bare soil.
 */
export function simulateSeason(input: SeasonInput, weather: WeatherDay[]): SeasonResult {
  const { site } = input;
  const dT = input.deltaT ?? 0;
  const pf = input.precipFactor ?? 1;
  const crops = input.crops
    .map((c) => ({ run: c, p: CROPS[c.crop] }))
    .filter((c): c is { run: CropRun; p: CropParams } => Boolean(c.p));
  const windows = crops.map((c) => ({
    ...c,
    start: c.run.sowing,
    end: addDays(c.run.sowing, seasonLength(c.p)),
  }));

  let dr = Math.max(0, input.startDepletionMm);
  let runoff = 0,
    drainage = 0,
    precip = 0,
    irrigation = 0,
    bare = 0,
    cSum = 0,
    etaTotal = 0;
  const per = windows.map(() => ({ etc: 0, eta: 0, irr: 0, uncapped: 0, capped: false }));
  const capLeft = { mm: input.waterCapMm ?? Infinity };

  for (const day of weather) {
    const p = Math.max(0, day.precip * pf);
    precip += p;
    const i = windows.findIndex((w) => day.date >= w.start && day.date < w.end);
    const w = i >= 0 ? windows[i]! : null;
    const d = w
      ? Math.round((Date.parse(`${day.date}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)) / 86_400_000)
      : 0;
    const zr = w ? rootDepthOnDay(w.p, d) : 0.15; // bare soil: evaporation layer only
    const taw = site.awsMmPerM * Math.max(zr, 0.15);
    const pDep = w ? w.p.p : 0.5;
    const raw = pDep * taw;
    const kc = w ? kcOnDay(w.p, d) : FALLOW_KC;
    const cover = w ? w.p.cover : "fallow";
    if (!w) bare += 1;
    cSum += w ? w.p.cFactor : BARE_C;

    const ro = scsRunoff(p, curveNumber(cover, site.hydGroup));
    runoff += ro;
    const ref = et0(day, site, dT);
    const etc = kc * ref;

    // Irrigation: refill to field capacity once depletion reaches RAW (FAO-56 §8 irrigation scheduling).
    let irr = 0;
    if (w && input.irrigated && dr >= raw) {
      const want = dr;
      per[i]!.uncapped += want;
      irr = Math.min(want, capLeft.mm);
      if (irr < want) per[i]!.capped = true;
      capLeft.mm -= irr;
    }
    irrigation += irr;

    // Depletion after rain, irrigation and ET (Eq. 85); stress coefficient Ks (Eq. 84).
    dr = dr - (p - ro) - irr;
    let dp = 0;
    if (dr < 0) {
      dp = -dr;
      dr = 0;
    }
    drainage += dp;
    const ks = dr > raw ? Math.max(0, (taw - dr) / ((1 - pDep) * taw)) : 1;
    // ET can't take the root zone below wilting point.
    const eta = Math.min(ks * etc, Math.max(0, taw - dr));
    dr += eta;
    etaTotal += eta;
    if (w) {
      per[i]!.etc += etc;
      per[i]!.eta += eta;
      per[i]!.irr += irr;
    }
  }

  return {
    crops: windows.map((w, k) => {
      const r = per[k]!;
      const ratio = r.etc > 0 ? Math.max(0, 1 - w.p.ky * (1 - r.eta / r.etc)) : 0;
      return {
        crop: w.run.crop,
        sowing: w.start,
        harvest: w.end,
        etcMm: r.etc,
        etaMm: r.eta,
        irrigationMm: r.irr,
        yieldRatio: Math.min(1, ratio),
        uncappedIrrigationMm: r.uncapped,
        capped: r.capped,
      };
    }),
    precipMm: precip,
    runoffMm: runoff,
    drainageMm: drainage,
    irrigationMm: irrigation,
    etaTotalMm: etaTotal,
    endDepletionMm: dr,
    bareDays: bare,
    meanC: weather.length ? cSum / weather.length : BARE_C,
    days: weather.length,
  };
}
