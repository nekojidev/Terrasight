import {
  CROPS,
  kcOnDay,
  rootDepthOnDay,
  seasonLength,
  simulateSeason,
  type HydGroup,
  type WeatherDay,
} from "@terrasight/simulator";
import { confidence } from "./evaluate.js";
import type {
  Citation,
  ConfidenceLevel,
  EvalInputs,
  Evidence,
  KeyNumber,
  Level,
  NodeResult,
} from "./types.js";

/**
 * Weather and irrigation evaluators (L-13). Unlike pest models they are not library trees: each is a fixed rule with
 * its source named in the citations. Pure functions: same inputs, same result. A missing input gives `null`
 * (no item), never a guess.
 */
export interface AlertResult {
  /** Stored as the recommendation subject. */
  subject: "frost_alert" | "water_stress";
  type: "weather" | "irrigation";
  level: Level;
  deadline: string | null;
  irreversible: boolean;
  keyNumbers: KeyNumber[];
  drivers: NodeResult["drivers"];
  evidence: Evidence[];
  citations: Citation[];
  unknowns: string[];
  confidence: ConfidenceLevel;
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000);
/** Forecast days 1–7 only (RFC §13: days beyond 7 are not used by evaluators). */
const HORIZON_DAYS = 7;
const RELIABLE_FORECAST_DAYS = 5;
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- frost_alert ----------

const FROST_CITATION: Citation = {
  threshold: "frostC",
  value: 0,
  unit: "°C",
  title:
    "Air frost: air temperature at or below 0 °C (the freezing point of water); WMO International Meteorological Vocabulary (WMO-No. 182) / AMS Glossary of Meteorology",
  publisher: "WMO",
  url: null,
  accessed: null,
  type: "fallback",
  quote: null,
};

/** The crop on the field now: this season's record, else the current-season crop from the history. */
function currentCrop(inp: EvalInputs): { crop: string; estimated: boolean } | null {
  const rec = inp.record.crop;
  if (rec.value) return { crop: rec.value, estimated: rec.source !== "confirmed" && rec.source !== "plan" };
  const c = inp.crops.find((x) => x.season === inp.season);
  if (c) return { crop: c.mainCrop, estimated: !c.isOverride && c.confidence < 0.7 };
  return null;
}

/**
 * `frost_alert`: forecast daily minimum air temperature ≤ 0 °C within the next 7 days on a field with a growing crop.
 * 0 °C is the freezing point of water (the definition of air frost); no crop-specific damage threshold is claimed.
 */
export function frostAlert(inp: EvalInputs, asOf: string): AlertResult | null {
  const crop = currentCrop(inp);
  if (!crop) return null;
  const { sowingDate, emergenceDate } = inp.record;
  // Not growing yet: sowing or emergence still ahead.
  if ((sowingDate.value && sowingDate.value > asOf) || (emergenceDate.value && emergenceDate.value > asOf))
    return null;
  const upcoming = inp.weather.filter(
    (w) => w.origin === "forecast" && w.date >= asOf && (w.forecastDay ?? 99) <= HORIZON_DAYS,
  );
  if (!upcoming.length) return null;
  const frosts = upcoming.filter((w) => w.tminC !== null && w.tminC <= 0);
  const first = frosts[0];
  const estimated: string[] = [];
  if (crop.estimated) estimated.push("crop not confirmed");
  if (first && (first.forecastDay ?? 0) > RELIABLE_FORECAST_DAYS)
    estimated.push(`relies on forecast day ${first.forecastDay}`);
  const unknowns = [
    "Frost forecast only: crop-specific damage thresholds are not modelled. Check sensitive crops and growth stages in the field.",
  ];
  if (!sowingDate.value && !emergenceDate.value) unknowns.push("sowing and emergence dates are not recorded");
  const minT = frosts.length ? Math.min(...frosts.map((f) => f.tminC!)) : 0;
  return {
    subject: "frost_alert",
    type: "weather",
    level: first ? "moderate" : "none",
    deadline: first?.date ?? null,
    irreversible: false,
    keyNumbers: first
      ? [
          { id: "frostDate", value: first.date, weight: 1 },
          { id: "frostMinC", value: round1(first.tminC!), unit: "°C", weight: 0.66 },
          { id: "daysUntilFrost", value: daysBetween(asOf, first.date), unit: "days", weight: 0.33 },
        ]
      : [],
    drivers: [
      { driver: "forecast_frost", value: first ? first.date : "none", fired: Boolean(first) },
      { driver: "crop", value: crop.crop, fired: false },
    ],
    evidence: first
      ? [
          {
            source: "Open-Meteo / NOAA NWS daily forecast, minimum air temperature",
            from: upcoming[0]!.date,
            to: upcoming.at(-1)!.date,
            value: round1(minT),
            unit: "°C",
            note: `${frosts.length} day(s) at or below 0 °C; first on ${first.date}`,
          },
        ]
      : [],
    citations: [FROST_CITATION],
    unknowns: [...unknowns, ...estimated.map((e) => `Estimated: ${e}`)],
    confidence: confidence(inp.tier, estimated.length, false),
  };
}

// ---------- water_stress ----------

export interface WaterSite {
  latDeg: number;
  elevationM: number;
  /** Plant-available water, mm per metre of soil (SSURGO AWS); null when the soil is unknown. */
  awsMmPerM: number | null;
  /** True when derived from the 0–150 cm value rather than 0–100 cm. */
  awsEstimated: boolean;
  hydGroup: HydGroup | null;
  slopePct: number;
  /** Irrigated per the season record or the field; null / false = no item. */
  irrigated: boolean | null;
}

const FAO56_URL = "https://www.fao.org/4/x0490e/x0490e00.htm";
const faoCitation = (crop: string, p: number, adapted: boolean): Citation => ({
  threshold: "p",
  value: p,
  unit: "fraction of TAW",
  title: `Crop evapotranspiration: Guidelines for computing crop water requirements, FAO Irrigation and Drainage Paper 56 (Allen et al. 1998): Table 22 (depletion fraction p, ${crop}), Eq. 82–85 (TAW, RAW = p·TAW, Ks, root-zone depletion Dr)${adapted ? "; value adapted for the region, not read directly from Table 22" : ""}`,
  publisher: "FAO",
  url: FAO56_URL,
  accessed: "2026-11-15",
  type: adapted ? "calibration" : "extension",
  quote: null,
});

/**
 * `water_stress` (irrigated fields): FAO-56 root-zone depletion Dr vs readily available water RAW = p·TAW.
 * Dr today comes from the FAO-56 water balance (packages/simulator) from sowing with NASA POWER and recently observed
 * weather, assuming irrigation whenever Dr reached RAW (applications are not recorded). The forecast (days 1–7, no
 * irrigation) then gives the first day Dr exceeds RAW: "irrigation needed within N days".
 */
export function waterStress(inp: EvalInputs, site: WaterSite | null, asOf: string): AlertResult | null {
  if (!site || site.irrigated !== true || site.awsMmPerM === null || site.awsMmPerM <= 0) return null;
  const crop = currentCrop(inp);
  const params = crop ? CROPS[crop.crop] : undefined;
  const sowing = inp.record.sowingDate.value;
  if (!crop || !params || !sowing || sowing >= asOf) return null;
  if (daysBetween(sowing, asOf) >= seasonLength(params)) return null; // past maturity
  const toDay = (w: (typeof inp.weather)[number]): WeatherDay | null =>
    w.tminC === null || w.tmaxC === null || w.precipMm === null
      ? null
      : { date: w.date, tmin: w.tminC, tmax: w.tmaxC, precip: w.precipMm };
  const past = inp.weather.filter((w) => w.origin !== "forecast" && w.date >= sowing && w.date < asOf);
  const span = daysBetween(sowing, asOf);
  const histDays = past.map(toDay).filter((d): d is WeatherDay => d !== null);
  if (histDays.length < span * 0.9) return null; // gaps: unknown, never a guess
  const forecast: WeatherDay[] = [];
  for (const w of inp.weather) {
    if (w.origin !== "forecast" || w.date < asOf || (w.forecastDay ?? 99) > HORIZON_DAYS) continue;
    const d = toDay(w);
    if (!d) break;
    forecast.push(d);
  }
  const base = {
    site: {
      latDeg: site.latDeg,
      elevationM: site.elevationM,
      awsMmPerM: site.awsMmPerM,
      hydGroup: site.hydGroup,
      slopePct: site.slopePct,
    },
    crops: [{ crop: crop.crop, sowing }],
  };
  // Depletion at the start of today, assuming the field was at field capacity at sowing.
  const now = simulateSeason({ ...base, irrigated: true, startDepletionMm: 0 }, histDays).endDepletionMm;
  const limits = (date: string) => {
    const zr = rootDepthOnDay(params, daysBetween(sowing, date));
    const taw = site.awsMmPerM! * Math.max(zr, 0.15);
    return { taw, raw: params.p * taw };
  };
  const today = limits(asOf);
  let hit: { date: string; dr: number; raw: number; taw: number } | null =
    now > today.raw ? { date: asOf, dr: now, ...today } : null;
  for (let k = 1; !hit && k <= forecast.length; k++) {
    const dr = simulateSeason({ ...base, irrigated: false, startDepletionMm: now }, forecast.slice(0, k))
      .endDepletionMm;
    const date = forecast[k - 1]!.date;
    const l = limits(date);
    if (dr > l.raw) hit = { date, dr, ...l };
  }
  const days = hit ? daysBetween(asOf, hit.date) : null;
  const show = hit ?? { date: asOf, dr: now, ...today };
  const estimated: string[] = [];
  if (crop.estimated) estimated.push("crop not confirmed");
  if (inp.record.sowingDate.source !== "confirmed") estimated.push("sowing date estimated");
  if (site.awsEstimated) estimated.push("soil water capacity derived from the 0–150 cm value");
  if (days !== null && days + 1 > RELIABLE_FORECAST_DAYS) estimated.push(`relies on forecast day ${days + 1}`);
  return {
    subject: "water_stress",
    type: "irrigation",
    level: days === null ? "none" : days <= 2 ? "high" : "moderate",
    deadline: hit?.date ?? null,
    irreversible: false,
    keyNumbers: [
      { id: "daysToStress", value: days ?? "—", ...(days !== null ? { unit: "days" } : {}), weight: 1 },
      { id: "depletionMm", value: round1(show.dr), unit: "mm", weight: 0.75 },
      { id: "rawMm", value: round1(show.raw), unit: "mm", weight: 0.5 },
      { id: "tawMm", value: round1(show.taw), unit: "mm", weight: 0.25 },
    ],
    drivers: [{ driver: "root_zone_depletion", value: round1(show.dr), unit: "mm", fired: Boolean(hit) }],
    evidence: [
      {
        source:
          "FAO-56 water balance: NASA POWER + Open-Meteo observed and forecast weather, soil water capacity from SSURGO",
        from: sowing,
        to: forecast.at(-1)?.date ?? asOf,
        value: round1(show.dr),
        unit: "mm depletion",
        note: `RAW ${round1(show.raw)} mm = p ${params.p} × TAW ${round1(show.taw)} mm; Kc today ${kcOnDay(params, daysBetween(sowing, asOf)).toFixed(2)}`,
      },
    ],
    citations: [faoCitation(crop.crop, params.p, params.adapted ?? false)],
    unknowns: [
      "Irrigation applied so far is not recorded: the model assumes the field was irrigated whenever depletion reached RAW",
      "ET₀ by Hargreaves from daily min and max temperature; p is the Table 22 value for ETc ≈ 5 mm/day, not adjusted to the actual ETc",
      ...estimated.map((e) => `Estimated: ${e}`),
    ],
    confidence: confidence(inp.tier, estimated.length + 1, false),
  };
}
