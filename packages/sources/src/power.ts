import { cellKey } from "./geo.js";
import { httpJson } from "./http.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/**
 * NASA POWER daily weather (RFC D1, Tech Design §13): 1981 → the latest available day.
 * One request per grid cell; POWER's native grid is 0.5° × 0.625°, so fields in a cell share it.
 */
export const POWER_PARAMETERS = [
  "T2M", // mean air temperature, °C
  "T2M_MAX",
  "T2M_MIN",
  "PRECTOTCORR", // precipitation, mm/day
  "RH2M", // relative humidity, %
  "ALLSKY_SFC_SW_DWN", // solar radiation, MJ/m²/day
  "WS2M", // wind speed at 2 m, m/s
  "TS", // earth skin temperature, °C (surface proxy, not soil at depth)
] as const;
export type PowerParameter = (typeof POWER_PARAMETERS)[number];

export interface DailyWeather {
  /** ISO dates, ascending, no gaps. */
  dates: string[];
  values: Record<PowerParameter, Array<number | null>>;
  /** Grid cell the series belongs to (lon, lat of the POWER request). */
  cell: { lon: number; lat: number };
  elevationM: number | null;
}

export const POWER_START = "1981-01-01";
const FILL = -999;

interface PowerResponse {
  geometry?: { coordinates?: [number, number, number] };
  properties?: { parameter?: Record<string, Record<string, number>> };
  messages?: string[];
}

function compact(iso: string): string {
  return iso.replaceAll("-", "");
}

/** Snaps to the POWER grid centre so every field in a cell makes the identical request. */
export function powerCell(lon: number, lat: number): { lon: number; lat: number } {
  return {
    lon: Math.round(lon / 0.625) * 0.625,
    lat: Math.round(lat / 0.5) * 0.5,
  };
}

export function parsePower(json: PowerResponse, cell: { lon: number; lat: number }): DailyWeather {
  const params = json.properties?.parameter;
  if (!params)
    throw new SourceError(
      `returned no data${json.messages?.length ? ` (${json.messages.join("; ")})` : ""}`,
      false,
    );
  const dates = Object.keys(params.T2M ?? {}).sort();
  const values = Object.fromEntries(
    POWER_PARAMETERS.map((p) => [
      p,
      dates.map((d) => {
        const v = params[p]?.[d];
        return v === undefined || v === FILL ? null : v;
      }),
    ]),
  ) as DailyWeather["values"];
  // POWER fills the most recent days with -999 until data arrives; drop that tail so dataDate is honest.
  let last = dates.length - 1;
  while (last >= 0 && values.T2M[last] === null && values.PRECTOTCORR[last] === null) last--;
  const iso = dates.slice(0, last + 1).map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  for (const p of POWER_PARAMETERS) values[p] = values[p].slice(0, last + 1);
  return { dates: iso, values, cell, elevationM: json.geometry?.coordinates?.[2] ?? null };
}

export const power: SourceAdapter<DailyWeather> = {
  id: "power",
  appliesTo: () => true,
  cacheKey(field, { today }) {
    const c = powerCell(field.centroid.lon, field.centroid.lat);
    // History never changes; the key includes today so the recent tail refreshes daily.
    return `${cellKey(c.lon, c.lat, 0.0001)}:${POWER_START}:${today}`;
  },
  async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<DailyWeather>> {
    const cell = powerCell(field.centroid.lon, field.centroid.lat);
    const url =
      "https://power.larc.nasa.gov/api/temporal/daily/point" +
      `?parameters=${POWER_PARAMETERS.join(",")}&community=AG&longitude=${cell.lon}&latitude=${cell.lat}` +
      `&start=${compact(POWER_START)}&end=${compact(ctx.today)}&format=JSON&time-standard=UTC`;
    const json = await httpJson<PowerResponse>(url, {
      signal: ctx.signal,
      fetch: ctx.fetch,
      timeoutMs: 60_000,
    });
    const weather = parsePower(json, cell);
    return {
      status: weather.dates.length ? "done" : "failed",
      payload: weather,
      dataDate: weather.dates.at(-1) ?? null,
      attribution: "NASA POWER (power.larc.nasa.gov)",
      ...(weather.dates.length ? {} : { reason: "NASA POWER returned no days" }),
    };
  },
};
