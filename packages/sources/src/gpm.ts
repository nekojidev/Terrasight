import { http, httpJson, mapLimit, withRetry } from "./http.js";
import { SourceError, type FetchContext } from "./types.js";

/**
 * NASA GPM IMERG monthly precipitation (GPM_3IMERGM, Final Run, version 07, 0.1°) for one grid point (S-10.11).
 *
 * Access: NASA Earthdata Cloud OPeNDAP (Hyrax in the Cloud, `opendap.earthdata.nasa.gov`), one granule per month, with a
 * DAP4 constraint expression that selects a single cell, authenticated by an Earthdata Login bearer token. The granule
 * list (and with it the last available month) comes from the public NASA CMR. There is no time-series call for this
 * product, so a first read is about 300 small requests, done once and cached for 30 days.
 *
 * The product stores precipitation as a rate in mm/hr (the monthly mean rate). We convert it to mm per month:
 * mm/month = rate [mm/hr] × 24 × days in the month.
 *
 * Needs `EARTHDATA_TOKEN`, and the Earthdata profile must have accepted the "NASA GESDISC DATA ARCHIVE" application
 * (EULA); without it GES DISC answers 403 "EULA Acceptance Failure" and this adapter reports it plainly.
 */
export interface GpmMonth {
  month: string;
  /** Millimetres in the month; null when the cell has no value that month. */
  mm: number | null;
}

export interface GpmSeries {
  months: GpmMonth[];
  /** Centre of the 0.1° IMERG cell that was read. */
  cell: { lat: number; lon: number };
  /** First day of the last month in the series, ISO. */
  lastDate: string | null;
  product: "GPM_3IMERGM.07";
}

export const GPM_COLLECTION = "C2723754851-GES_DISC";
export const GPM_PRODUCT = "GPM_3IMERGM.07";
export const GPM_FIRST_YEAR = 2001;
const CMR = "https://cmr.earthdata.nasa.gov/search/granules.json";
const OPENDAP = `https://opendap.earthdata.nasa.gov/collections/${GPM_COLLECTION}/granules/`;
const FILL = -9999;
const CONCURRENCY = 3;

/** Grid indices of the 0.1° cell: precipitation is stored as [time][lon][lat], lon −180…180, lat −90…90. */
export function gpmCell(lat: number, lon: number): { i: number; j: number; lat: number; lon: number } {
  const i = Math.min(3599, Math.max(0, Math.floor((lon + 180) / 0.1 + 1e-9)));
  const j = Math.min(1799, Math.max(0, Math.floor((lat + 90) / 0.1 + 1e-9)));
  return {
    i,
    j,
    lon: Math.round((i * 0.1 - 179.95) * 100) / 100,
    lat: Math.round((j * 0.1 - 89.95) * 100) / 100,
  };
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** mm/hr (monthly mean rate) → mm per month. */
export function rateToMm(rateMmPerHour: number, month: string): number {
  return Math.round(rateMmPerHour * 24 * daysInMonth(month) * 10) / 10;
}

/** Granule ids ("GPM_3IMERGM.07:3B-MO…HDF5") from a CMR granules.json response, by month. */
export function parseGranules(json: unknown): Map<string, string> {
  const entries = (json as { feed?: { entry?: Array<{ title?: string }> } })?.feed?.entry ?? [];
  const out = new Map<string, string>();
  for (const e of entries) {
    const m = /3IMERG\.(\d{4})(\d{2})01-S000000/.exec(e.title ?? "");
    if (m && e.title!.startsWith(`${GPM_PRODUCT}:`)) out.set(`${m[1]}-${m[2]}`, e.title!);
  }
  return out;
}

/** The single value from a Hyrax DAP4 CSV answer (`.dap.csv`): the last plain number in the body; the fill value is null. */
export function parseGpmValue(body: string): number | null {
  if (/\bError\b\s*\{/.test(body) || /code\s*=\s*\d{3}/.test(body))
    throw new SourceError(`OPeNDAP returned an error (${body.replace(/\s+/g, " ").slice(0, 160)})`, false);
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^Dataset:/i.test(l));
  for (let k = lines.length - 1; k >= 0; k--) {
    // A value line is only a number; the header line "Grid/precipitation[0][789][1280]" is not.
    if (/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(lines[k]!)) {
      const v = Number(lines[k]);
      return v <= FILL ? null : v;
    }
  }
  throw new SourceError("returned no value", false);
}

function translate(e: unknown): never {
  if (e instanceof SourceError && /responded (401|403)/.test(e.message))
    throw new SourceError(
      "GES DISC rejected the Earthdata token (401/403): check EARTHDATA_TOKEN and accept the NASA GESDISC DATA ARCHIVE application in the Earthdata profile",
      false,
    );
  throw e;
}

/** Month list and granule ids from CMR (public, no token). */
export async function listGranules(ctx: Pick<FetchContext, "signal" | "fetch">): Promise<Map<string, string>> {
  const url = `${CMR}?collection_concept_id=${GPM_COLLECTION}&page_size=2000&sort_key=start_date`;
  const json = await withRetry(
    () => httpJson<unknown>(url, { signal: ctx.signal, fetch: ctx.fetch, timeoutMs: 30_000 }),
    { signal: ctx.signal },
  );
  const granules = parseGranules(json);
  if (!granules.size) throw new SourceError("CMR listed no IMERG monthly granules", true);
  return granules;
}

/** One month at one cell, in mm; throws a SourceError on failure. */
export async function readMonth(
  granule: string,
  month: string,
  cell: { i: number; j: number },
  token: string,
  ctx: Pick<FetchContext, "signal" | "fetch">,
): Promise<number | null> {
  const ce = encodeURIComponent(`/Grid/precipitation[0][${cell.i}][${cell.j}]`);
  const url = `${OPENDAP}${encodeURIComponent(granule)}.dap.csv?dap4.ce=${ce}`;
  const res = await withRetry(
    () =>
      http(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctx.signal,
        fetch: ctx.fetch,
        timeoutMs: 30_000,
      }).catch(translate),
    { attempts: 4, baseMs: 1000, signal: ctx.signal },
  );
  const rate = parseGpmValue(await res.text());
  return rate === null ? null : rateToMm(rate, month);
}

/** All months from `GPM_FIRST_YEAR` for the cell under (lat, lon). Fails as a whole when a month cannot be read. */
export async function fetchGpmSeries(
  lat: number,
  lon: number,
  token: string | undefined,
  ctx: Pick<FetchContext, "signal" | "fetch">,
): Promise<GpmSeries> {
  if (!token) throw new SourceError("GPM IMERG is not configured (EARTHDATA_TOKEN not set)", false);
  const cell = gpmCell(lat, lon);
  const granules = [...(await listGranules(ctx)).entries()]
    .filter(([m]) => Number(m.slice(0, 4)) >= GPM_FIRST_YEAR)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!granules.length) throw new SourceError("CMR listed no IMERG months from 2001", true);
  // The first month tells at once whether the token is accepted, before hundreds of requests go out.
  const first = granules[0]!;
  const firstMm = await readMonth(first[1], first[0], cell, token, ctx);
  const rest = await mapLimit(granules.slice(1), CONCURRENCY, ([m, g]) => readMonth(g, m, cell, token, ctx));
  const months: GpmMonth[] = granules.map(([m], k) => ({ month: m, mm: k === 0 ? firstMm : rest[k - 1]! }));
  return {
    months,
    cell: { lat: cell.lat, lon: cell.lon },
    lastDate: `${months.at(-1)!.month}-01`,
    product: GPM_PRODUCT,
  };
}
