import { httpJson } from "./http.js";
import { SourceError, type FetchContext } from "./types.js";

/** One day of forecast or recent observed weather (RFC §13). */
export interface ForecastDay {
  date: string;
  tminC: number | null;
  tmaxC: number | null;
  tmeanC: number | null;
  precipMm: number | null;
  et0Mm: number | null;
  /** `observed` = Open-Meteo's recent days (fills the NASA POWER lag, RFC §10.2); `forecast` = day 1… ahead. */
  origin: "observed" | "forecast";
  forecastDay?: number;
}

export interface Forecast {
  provider: "open-meteo" | "nws";
  /** Cell centre the request used (0.1° grid, Tech Design §8.3). */
  cell: { lat: number; lon: number };
  issuedAt: string;
  days: ForecastDay[];
  attribution: string;
}

/** Forecast cells are 0.1° (RFC §13): every field in a cell shares one request. */
export function forecastCell(lat: number, lon: number): { lat: number; lon: number; key: string } {
  const r = (v: number) => Math.round(v * 10) / 10;
  const c = { lat: r(lat), lon: r(lon) };
  return { ...c, key: `${c.lat.toFixed(1)},${c.lon.toFixed(1)}` };
}

const OM_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

/**
 * Open-Meteo daily forecast (10 days) plus the last 7 observed days. With a key the commercial endpoint is used
 * (RFC §13, paid plan); without one the free endpoint, for development and the hackathon demo.
 */
export async function openMeteoForecast(
  cell: { lat: number; lon: number },
  ctx: FetchContext,
  apiKey?: string,
): Promise<Forecast> {
  const host = apiKey ? "https://customer-api.open-meteo.com" : "https://api.open-meteo.com";
  const q = new URLSearchParams({
    latitude: String(cell.lat),
    longitude: String(cell.lon),
    daily:
      "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration",
    past_days: "7",
    forecast_days: "10",
    timezone: "UTC",
    ...(apiKey ? { apikey: apiKey } : {}),
  });
  const d = await httpJson<{
    daily?: {
      time: string[];
      temperature_2m_max: Array<number | null>;
      temperature_2m_min: Array<number | null>;
      temperature_2m_mean: Array<number | null>;
      precipitation_sum: Array<number | null>;
      et0_fao_evapotranspiration: Array<number | null>;
    };
  }>(`${host}/v1/forecast?${q}`, { signal: ctx.signal, fetch: ctx.fetch });
  const daily = d.daily;
  if (!daily?.time.length) throw new SourceError("returned no forecast days", true);
  const days: ForecastDay[] = daily.time.map((date, i) => {
    const ahead = Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86_400_000,
    );
    return {
      date,
      tminC: daily.temperature_2m_min[i] ?? null,
      tmaxC: daily.temperature_2m_max[i] ?? null,
      tmeanC: daily.temperature_2m_mean[i] ?? null,
      precipMm: daily.precipitation_sum[i] ?? null,
      et0Mm: daily.et0_fao_evapotranspiration[i] ?? null,
      ...(ahead < 0
        ? { origin: "observed" as const }
        : { origin: "forecast" as const, forecastDay: ahead + 1 }),
    };
  });
  return {
    provider: "open-meteo",
    cell,
    issuedAt: new Date().toISOString(),
    days,
    attribution: OM_ATTRIBUTION,
  };
}

interface NwsPeriod {
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: "F" | "C";
}

/** NOAA NWS gridpoint forecast, US fallback (RFC §13). Day highs and night lows; no precipitation amount or ET₀. */
export async function nwsForecast(cell: { lat: number; lon: number }, ctx: FetchContext): Promise<Forecast> {
  const headers = { Accept: "application/geo+json" };
  const point = await httpJson<{ properties?: { forecast?: string } }>(
    `https://api.weather.gov/points/${cell.lat},${cell.lon}`,
    { signal: ctx.signal, fetch: ctx.fetch, headers },
  );
  const url = point.properties?.forecast;
  if (!url) throw new SourceError("has no forecast for this point", false);
  const f = await httpJson<{ properties?: { updateTime?: string; periods?: NwsPeriod[] } }>(url, {
    signal: ctx.signal,
    fetch: ctx.fetch,
    headers,
  });
  const periods = f.properties?.periods ?? [];
  if (!periods.length) throw new SourceError("returned no forecast periods", true);
  const toC = (p: NwsPeriod) =>
    p.temperatureUnit === "F" ? Math.round((((p.temperature - 32) * 5) / 9) * 10) / 10 : p.temperature;
  const byDate = new Map<string, { hi?: number; lo?: number }>();
  for (const p of periods) {
    // Night periods start in the evening: their low belongs to the next morning's date.
    const local = p.startTime.slice(0, 10);
    const date = p.isDaytime
      ? local
      : new Date(Date.parse(`${local}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const e = byDate.get(date) ?? {};
    if (p.isDaytime) e.hi = toC(p);
    else e.lo = toC(p);
    byDate.set(date, e);
  }
  const days: ForecastDay[] = [...byDate.entries()]
    .filter(([date]) => date >= ctx.today)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => ({
      date,
      tminC: e.lo ?? null,
      tmaxC: e.hi ?? null,
      tmeanC: e.lo !== undefined && e.hi !== undefined ? Math.round(((e.lo + e.hi) / 2) * 10) / 10 : null,
      precipMm: null,
      et0Mm: null,
      origin: "forecast" as const,
      forecastDay:
        Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86_400_000) + 1,
    }));
  return {
    provider: "nws",
    cell,
    issuedAt: f.properties?.updateTime ?? new Date().toISOString(),
    days,
    attribution: "NOAA National Weather Service",
  };
}

/** First forecast day with frost (min ≤ 0 °C); days 8–10 are flagged uncertain (RFC §13). */
export function nextFrostDay(f: Forecast): { date: string; tminC: number; uncertain: boolean } | null {
  const d = f.days.find((x) => x.origin === "forecast" && x.tminC !== null && x.tminC <= 0);
  return d ? { date: d.date, tminC: d.tminC!, uncertain: (d.forecastDay ?? 0) > 7 } : null;
}
