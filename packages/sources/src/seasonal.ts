import { httpJson } from "./http.js";
import { SourceError, type FetchContext } from "./types.js";

/** Daily seasonal ensemble for one 0.1° cell: the same dates for every member. */
export interface SeasonalEnsemble {
  provider: "open-meteo-seasonal";
  /** Cell centre the request used (0.1° grid, shared with the 10-day forecast). */
  cell: { lat: number; lon: number };
  /** Date the ensemble was retrieved (the first day of `dates` is that day). */
  issuedAt: string;
  model: string;
  /** ISO dates, ascending, no gaps. */
  dates: string[];
  /** [member][day]: member 0 is the control run, then the 50 perturbed members. null = missing. */
  tmaxC: Array<Array<number | null>>;
  tminC: Array<Array<number | null>>;
  precipMm: Array<Array<number | null>>;
  /**
   * Ensemble-mean monthly anomalies against SEAS5's own reforecast climatology (Open-Meteo `monthly=…_anomaly`).
   * They let the raw daily values be de-biased: raw mean minus anomaly is the model's own normal for that month.
   */
  monthly: { months: string[]; tempAnomalyC: Array<number | null>; precipAnomalyMm: Array<number | null> };
  attribution: string;
}

const ATTRIBUTION =
  "Seasonal forecast by Open-Meteo.com (CC BY 4.0), ECMWF SEAS5 ensemble (Copernicus Climate Change Service)";

/**
 * Open-Meteo Seasonal Forecast API: ECMWF SEAS5, 51 members, daily, up to 217 days. Free for non-commercial use under
 * CC BY 4.0 with attribution; with a key the commercial endpoint is used (as for the 10-day forecast).
 */
export async function openMeteoSeasonal(
  cell: { lat: number; lon: number },
  days: number,
  ctx: FetchContext,
  apiKey?: string,
): Promise<SeasonalEnsemble> {
  const host = apiKey ? "https://customer-seasonal-api.open-meteo.com" : "https://seasonal-api.open-meteo.com";
  const q = new URLSearchParams({
    latitude: String(cell.lat),
    longitude: String(cell.lon),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    monthly: "temperature_2m_anomaly,precipitation_anomaly",
    forecast_days: String(Math.min(217, Math.max(1, Math.round(days)))),
    timezone: "UTC",
    ...(apiKey ? { apikey: apiKey } : {}),
  });
  const d = await httpJson<{ daily?: Record<string, unknown>; monthly?: Record<string, unknown> }>(`${host}/v1/seasonal?${q}`, {
    signal: ctx.signal,
    fetch: ctx.fetch,
    timeoutMs: 60_000,
  });
  return parseSeasonal(d, cell, ctx.today);
}

export function parseSeasonal(
  d: { daily?: Record<string, unknown>; monthly?: Record<string, unknown> },
  cell: { lat: number; lon: number },
  today: string,
): SeasonalEnsemble {
  const daily = d.daily;
  const dates = daily?.time as string[] | undefined;
  if (!daily || !dates?.length) throw new SourceError("returned no seasonal days", true);
  const members = (name: string): Array<Array<number | null>> => {
    // `name` is the control run; `name_memberNN` the perturbed ones.
    const keys = [name, ...Object.keys(daily).filter((k) => k.startsWith(`${name}_member`)).sort()];
    return keys.filter((k) => Array.isArray(daily[k])).map((k) => daily[k] as Array<number | null>);
  };
  const tmaxC = members("temperature_2m_max");
  const tminC = members("temperature_2m_min");
  const precipMm = members("precipitation_sum");
  if (tmaxC.length < 10 || tmaxC.length !== tminC.length || tmaxC.length !== precipMm.length)
    throw new SourceError("returned too few ensemble members", true);
  const mo = d.monthly;
  const times = (mo?.time as string[] | undefined) ?? [];
  const col = (k: string) => (Array.isArray(mo?.[k]) ? (mo![k] as Array<number | null>) : times.map(() => null));
  return {
    provider: "open-meteo-seasonal",
    cell,
    issuedAt: today,
    model: "ECMWF SEAS5",
    dates,
    tmaxC,
    tminC,
    precipMm,
    monthly: {
      months: times.map((t) => t.slice(0, 7)),
      tempAnomalyC: col("temperature_2m_anomaly"),
      precipAnomalyMm: col("precipitation_anomaly"),
    },
    attribution: ATTRIBUTION,
  };
}
