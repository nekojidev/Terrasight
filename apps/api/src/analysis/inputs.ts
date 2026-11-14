import type { DailyWeather as EvalDay } from "@terrasight/evaluators";
import type { DailyWeather as PowerSeries, Forecast, S2Result } from "@terrasight/sources";

/**
 * Daily weather for evaluators (RFC §10.2): NASA POWER history up to its last day, then Open-Meteo's recent observed
 * days to fill the POWER lag, then the forecast. Each row keeps its origin for the evidence.
 */
export function mergeWeather(power: PowerSeries | null, forecast: Forecast | null, today: string): EvalDay[] {
  const out: EvalDay[] = [];
  let lastPower = "";
  if (power) {
    const v = power.values;
    power.dates.forEach((date, i) => {
      const tmean = v.T2M[i] ?? null;
      if (tmean === null && v.T2M_MIN[i] == null) return; // POWER pads the tail with fill values
      out.push({
        date,
        tminC: v.T2M_MIN[i] ?? null,
        tmaxC: v.T2M_MAX[i] ?? null,
        tmeanC: tmean,
        precipMm: v.PRECTOTCORR[i] ?? null,
        soilC: v.TS[i] ?? null,
        origin: "power",
      });
      lastPower = date;
    });
  }
  for (const d of forecast?.days ?? []) {
    if (d.date <= lastPower) continue;
    if (d.origin === "observed" && d.date >= today) continue;
    out.push({
      date: d.date,
      tminC: d.tminC,
      tmaxC: d.tmaxC,
      tmeanC: d.tmeanC ?? (d.tminC !== null && d.tmaxC !== null ? (d.tminC + d.tmaxC) / 2 : null),
      precipMm: d.precipMm,
      origin: d.origin,
      ...(d.forecastDay ? { forecastDay: d.forecastDay } : {}),
    });
  }
  return out;
}

/** Latest date with observed (not forecast) weather: the field's data date (S-03.03). */
export function observedUntil(weather: EvalDay[]): string | null {
  for (let i = weather.length - 1; i >= 0; i--)
    if (weather[i]!.origin !== "forecast") return weather[i]!.date;
  return null;
}

/** Sentinel-2 5-day NDVI composites → dated observations (window end), clear ones only. */
export function ndviObservations(s2: S2Result | null, minClear = 0.6): Array<{ date: string; mean: number }> {
  return (s2?.ndvi ?? []).filter((n) => n.clear >= minClear).map((n) => ({ date: n.to, mean: n.mean }));
}
