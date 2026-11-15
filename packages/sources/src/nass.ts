import { USER_AGENT } from "./http.js";

/**
 * USDA NASS Quick Stats county yields (EP-10 S-10.07). SURVEY, YIELD, county level, annual.
 * Public domain; needs a free API key (NASS_API_KEY) and keeps within fair-use limits (50,000 records per call).
 * The key is only ever sent as the `key` query parameter and is stripped from every message this module produces.
 */

export const NASS_URL = "https://quickstats.nass.usda.gov/api/api_GET/";
export const NASS_ATTRIBUTION = "USDA NASS Quick Stats (county survey yields)";
export const NASS_FIRST_YEAR = 1981;

/**
 * Conversion factors (all exact by definition):
 *  - 1 lb = 0.45359237 kg (international avoirdupois pound, NIST Handbook 44 App. C)
 *  - 1 acre = 0.40468564224 ha (US survey definition via 4046.8564224 m2, NIST SP 811)
 *  - 1 short ton = 2000 lb = 907.18474 kg (NIST SP 811)
 *  - legal bushel weights (lb/bu) used by NASS for crop reporting: corn 56, sorghum 56, wheat 60, soybeans 60
 *    (USDA NASS Crop Production "Conversion factors", 7 CFR 810 / state weights-and-measures acts).
 */
export const KG_PER_LB = 0.45359237;
export const HA_PER_ACRE = 0.40468564224;
export const KG_PER_SHORT_TON = 907.18474;

type Unit = "BU / ACRE" | "LB / ACRE" | "TONS / ACRE";

export interface NassCrop {
  commodity: string;
  /** class_desc; omitted = not filtered. */
  cls?: string;
  /** util_practice_desc; omitted = not filtered. */
  util?: string;
  unit: Unit;
  /** lb per bushel; only for BU / ACRE. */
  lbPerBu?: number;
  note?: string;
}

/**
 * Library crop id (packages/simulator/src/crops.ts) → NASS series. Crops with no county yield series in Quick Stats
 * (e.g. forage sorghum, millet, canola in most counties) are absent: the caller gets "no series", never a guess.
 */
export const NASS_CROPS: Record<string, NassCrop> = {
  corn: { commodity: "CORN", cls: "ALL CLASSES", util: "GRAIN", unit: "BU / ACRE", lbPerBu: 56 },
  sorghum: { commodity: "SORGHUM", cls: "ALL CLASSES", util: "GRAIN", unit: "BU / ACRE", lbPerBu: 56 },
  winter_wheat: { commodity: "WHEAT", cls: "WINTER", unit: "BU / ACRE", lbPerBu: 60 },
  spring_wheat: { commodity: "WHEAT", cls: "SPRING, (EXCL DURUM)", unit: "BU / ACRE", lbPerBu: 60 },
  soybean: { commodity: "SOYBEANS", cls: "ALL CLASSES", unit: "BU / ACRE", lbPerBu: 60 },
  // Oil-type sunflower, pounds per acre of seed as published.
  sunflower: { commodity: "SUNFLOWER", cls: "OIL TYPE", unit: "LB / ACRE" },
  // Upland cotton, lint, pounds per acre.
  cotton: { commodity: "COTTON", cls: "UPLAND", unit: "LB / ACRE", note: "lint" },
  // Alfalfa hay, short tons per acre (as published, hay at storage moisture).
  alfalfa: { commodity: "HAY", cls: "ALFALFA", unit: "TONS / ACRE" },
  // Corn silage, short tons per acre of wet (as-chopped, ~65 % moisture) forage, as published.
  silage_corn: { commodity: "CORN", cls: "ALL CLASSES", util: "SILAGE", unit: "TONS / ACRE", note: "wet forage" },
};

export type Practice = "all" | "irrigated" | "non-irrigated";

export interface CountyYield {
  year: number;
  practice: Practice;
  /** t/ha; null when NASS withheld the value ("(D)" etc.). */
  tPerHa: number | null;
  /** The value as published and its unit. */
  raw: string;
  unit: string;
}

export type NassResult =
  | { connected: false; reason: string }
  | { connected: true; ok: false; reason: string }
  | {
      connected: true;
      ok: true;
      crop: string;
      area: string;
      stateAlpha: string;
      countyFips: string | null;
      /** Missing / withheld years are not in the list or have tPerHa null. */
      rows: CountyYield[];
      fetchedAt: string;
    };

export interface NassQuery {
  stateAlpha: string;
  /** County name ("Finney" or "Finney County"); or countyFips (5-digit GEOID "20055", or 3-digit county code). */
  countyName?: string;
  countyFips?: string;
  /** Library crop id. */
  crop: string;
  fromYear?: number;
  toYear?: number;
}

export interface NassContext {
  apiKey?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Published value → t/ha for the crop, or null when it is not a number ("(D)", "(NA)", "(Z)", ""). */
export function toTPerHa(value: string, crop: NassCrop): number | null {
  const v = Number(value.replace(/,/g, "").trim());
  if (value.trim() === "" || !Number.isFinite(v) || /[()]/.test(value)) return null;
  let kgPerAcre: number;
  if (crop.unit === "BU / ACRE") kgPerAcre = v * (crop.lbPerBu ?? Number.NaN) * KG_PER_LB;
  else if (crop.unit === "LB / ACRE") kgPerAcre = v * KG_PER_LB;
  else kgPerAcre = v * KG_PER_SHORT_TON;
  if (!Number.isFinite(kgPerAcre)) return null;
  return Math.round((kgPerAcre / HA_PER_ACRE / 1000) * 1000) / 1000;
}

export function practiceOf(desc: string): Practice | null {
  const d = desc.toUpperCase();
  if (d === "ALL PRODUCTION PRACTICES") return "all";
  if (d === "IRRIGATED") return "irrigated";
  if (d === "NON-IRRIGATED") return "non-irrigated";
  return null; // e.g. "IRRIGATED, FULL" or "NON-IRRIGATED, CONTINUOUS" sub-practices are not mixed in
}

export function normalizeCounty(name: string): string {
  return name
    .trim()
    .replace(/\s+(county|parish|borough)$/i, "")
    .toUpperCase();
}

/** Cache key for a county + crop; contains no key, no date. */
export function nassCacheKey(q: Pick<NassQuery, "stateAlpha" | "countyName" | "countyFips" | "crop">): string {
  const where = q.countyFips ? `fips:${q.countyFips}` : `name:${normalizeCounty(q.countyName ?? "")}`;
  return `nass:yield:v1:${q.stateAlpha.toUpperCase()}:${where}:${q.crop}`;
}

/** Cache key for a state-level series (EP-10 S-10.08); contains no key, no date. */
export function nassStateCacheKey(q: Pick<NassQuery, "stateAlpha" | "crop">): string {
  return `nass:yield:v1:${q.stateAlpha.toUpperCase()}:state:${q.crop}`;
}

/** Removes the API key from any text that could be logged or stored. */
export function stripKey(text: string, key?: string): string {
  let out = text.replace(/([?&]key=)[^&\s"']*/gi, "$1***");
  if (key) out = out.split(key).join("***");
  return out;
}

interface NassRecord {
  year: number | string;
  Value: string;
  prodn_practice_desc: string;
  class_desc: string;
  util_practice_desc: string;
  unit_desc: string;
  county_name: string;
  state_alpha: string;
  state_name?: string;
  /** "YEAR" = the final annual value; "YEAR - AUG FORECAST" etc. are in-season forecasts (state level only). */
  reference_period_desc?: string;
  state_fips_code?: string;
  county_ansi?: string;
}

class NassTooBig extends Error {}

async function call(
  params: Record<string, string>,
  ctx: NassContext,
): Promise<{ data: NassRecord[] } | { error: string }> {
  const f = ctx.fetch ?? fetch;
  const url = `${NASS_URL}?${new URLSearchParams({ ...params, key: ctx.apiKey ?? "", format: "JSON" })}`;
  const timeout = AbortSignal.timeout(ctx.timeoutMs ?? 30_000);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await f(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal });
  } catch (e) {
    return { error: timeout.aborted ? "did not respond in time" : `network error (${stripKey((e as Error).message, ctx.apiKey)})` };
  }
  type Body = { data?: NassRecord[]; error?: string[] | string };
  const body = (await res.json().catch(() => null)) as Body | null;
  const msg = body?.error ? [body.error].flat().join("; ") : "";
  if (res.status === 400 && /exceeds limit/i.test(msg)) throw new NassTooBig(msg);
  // NASS answers 400 "bad request - invalid query" when no record matches the (valid) filters, e.g. a crop the county does not grow.
  if (res.status === 400 && /no data|invalid query/i.test(msg)) return { data: [] };
  if (res.status === 401 || res.status === 403) return { error: "NASS rejected the API key" };
  if (!res.ok) return { error: `responded ${res.status}${msg ? ` (${stripKey(msg, ctx.apiKey)})` : ""}` };
  return { data: body?.data ?? [] };
}

/** Fetches a year range; on "exceeds limit" splits it in halves (a single year that is still too big fails). */
async function range(
  base: Record<string, string>,
  from: number,
  to: number,
  ctx: NassContext,
): Promise<{ data: NassRecord[] } | { error: string }> {
  try {
    return await call({ ...base, year__GE: String(from), year__LE: String(to) }, ctx);
  } catch (e) {
    if (!(e instanceof NassTooBig)) throw e;
    if (from >= to) return { error: "query exceeds the NASS record limit even for one year" };
    const mid = Math.floor((from + to) / 2);
    const a = await range(base, from, mid, ctx);
    if ("error" in a) return a;
    const b = await range(base, mid + 1, to, ctx);
    if ("error" in b) return b;
    return { data: [...a.data, ...b.data] };
  }
}

function baseQuery(crop: NassCrop, state: string, level: "COUNTY" | "STATE"): Record<string, string> {
  const base: Record<string, string> = {
    source_desc: "SURVEY",
    sector_desc: "CROPS",
    statisticcat_desc: "YIELD",
    agg_level_desc: level,
    state_alpha: state,
    commodity_desc: crop.commodity,
    unit_desc: crop.unit,
  };
  if (crop.cls) base.class_desc = crop.cls;
  if (crop.util) base.util_practice_desc = crop.util;
  return base;
}

/**
 * State-level yields for one crop (same crop mapping and practices as the county series), in t/ha. Used when a county
 * has too few published values (EP-10 S-10.08). Never throws.
 */
export async function fetchStateYields(
  q: Pick<NassQuery, "stateAlpha" | "crop" | "fromYear" | "toYear">,
  ctx: NassContext = {},
): Promise<NassResult> {
  if (!ctx.apiKey) return { connected: false, reason: "USDA NASS API key is not configured" };
  const crop = NASS_CROPS[q.crop];
  if (!crop) return { connected: true, ok: false, reason: `no NASS yield series for ${q.crop}` };
  const state = q.stateAlpha.toUpperCase();
  const res = await range(
    baseQuery(crop, state, "STATE"),
    q.fromYear ?? NASS_FIRST_YEAR,
    q.toYear ?? new Date().getUTCFullYear(),
    ctx,
  );
  if ("error" in res) return { connected: true, ok: false, reason: res.error };
  return parseCountyYields(res.data, q.crop, state, null, new Date().toISOString(), true);
}

/**
 * County yields for one crop, per year and production practice, in t/ha. Never throws: without a key the result is
 * `{ connected: false }`; failures are `{ connected: true, ok: false, reason }`.
 */
export async function fetchCountyYields(q: NassQuery, ctx: NassContext = {}): Promise<NassResult> {
  if (!ctx.apiKey) return { connected: false, reason: "USDA NASS API key is not configured" };
  const crop = NASS_CROPS[q.crop];
  if (!crop) return { connected: true, ok: false, reason: `no NASS county yield series for ${q.crop}` };
  const state = q.stateAlpha.toUpperCase();
  const base = baseQuery(crop, state, "COUNTY");
  let fips: string | null = null;
  if (q.countyFips) {
    const f = q.countyFips.trim();
    fips = f.length === 5 ? f : null;
    base.county_ansi = f.slice(-3);
    if (f.length === 5) base.state_fips_code = f.slice(0, 2);
  } else if (q.countyName) base.county_name = normalizeCounty(q.countyName);
  else return { connected: true, ok: false, reason: "county name or FIPS is required" };

  const res = await range(base, q.fromYear ?? NASS_FIRST_YEAR, q.toYear ?? new Date().getUTCFullYear(), ctx);
  if ("error" in res) return { connected: true, ok: false, reason: res.error };
  return parseCountyYields(res.data, q.crop, state, fips);
}

/** Parses Quick Stats records (a recorded response works too). Drops sub-practices and other classes. */
export function parseCountyYields(
  records: NassRecord[],
  cropId: string,
  stateAlpha: string,
  countyFips: string | null = null,
  fetchedAt = new Date().toISOString(),
  stateLevel = false,
): NassResult {
  const crop = NASS_CROPS[cropId];
  if (!crop) return { connected: true, ok: false, reason: `no NASS county yield series for ${cropId}` };
  const rows: CountyYield[] = [];
  let county = "";
  let stateName = "";
  for (const r of records) {
    if (r.unit_desc !== crop.unit) continue;
    if (r.reference_period_desc && r.reference_period_desc.toUpperCase() !== "YEAR") continue; // forecasts are not yields
    if (crop.cls && r.class_desc !== crop.cls) continue;
    if (crop.util && r.util_practice_desc !== crop.util) continue;
    const practice = practiceOf(r.prodn_practice_desc);
    if (!practice) continue;
    county ||= r.county_name;
    stateName ||= r.state_name ?? "";
    rows.push({
      year: Number(r.year),
      practice,
      tPerHa: toTPerHa(r.Value, crop),
      raw: r.Value,
      unit: r.unit_desc,
    });
  }
  rows.sort((a, b) => a.year - b.year || a.practice.localeCompare(b.practice));
  const title = county.toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase());
  return {
    connected: true,
    ok: true,
    crop: cropId,
    area: stateLevel
      ? stateName
        ? stateName.toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase())
        : stateAlpha
      : county
        ? `${title} County, ${stateAlpha}`
        : stateAlpha,
    stateAlpha,
    countyFips,
    rows,
    fetchedAt,
  };
}
