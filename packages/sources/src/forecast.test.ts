import { describe, expect, it } from "vitest";
import { forecastCell, nextFrostDay, nwsForecast, openMeteoForecast } from "./forecast.js";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const ctx = (f: (url: string) => Response) => ({
  signal: new AbortController().signal,
  fetch: (async (u: string | URL) => f(String(u))) as typeof fetch,
  today: "2026-11-14",
});

describe("forecast cell", () => {
  it("rounds to 0.1° so fields in one cell share a request", () => {
    expect(forecastCell(38.09913, -101.05474)).toEqual({ lat: 38.1, lon: -101.1, key: "38.1,-101.1" });
    expect(forecastCell(38.06, -101.14).key).toBe("38.1,-101.1");
  });
});

describe("Open-Meteo", () => {
  const body = {
    daily: {
      time: ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-22"],
      temperature_2m_max: [14, 9, 6, 5],
      temperature_2m_min: [0.3, 1.5, -2, -4],
      temperature_2m_mean: [6, 4, 2, 0],
      precipitation_sum: [0, 4, 0, 0],
      et0_fao_evapotranspiration: [1, 0.9, 0.7, 0.5],
    },
  };
  it("splits recent observed days from forecast days and finds the first frost", async () => {
    let url = "";
    const f = await openMeteoForecast(
      { lat: 38.1, lon: -101.1 },
      ctx((u) => ((url = u), json(body))),
    );
    expect(url).toContain("api.open-meteo.com");
    expect(f.days.map((d) => [d.origin, d.forecastDay])).toEqual([
      ["observed", undefined],
      ["forecast", 1],
      ["forecast", 2],
      ["forecast", 9],
    ]);
    expect(nextFrostDay(f)).toEqual({ date: "2026-11-15", tminC: -2, uncertain: false });
    expect(f.attribution).toContain("Open-Meteo");
  });
  it("uses the commercial endpoint with a key", async () => {
    let url = "";
    await openMeteoForecast(
      { lat: 38.1, lon: -101.1 },
      ctx((u) => ((url = u), json(body))),
      "k",
    );
    expect(url).toMatch(/^https:\/\/customer-api\.open-meteo\.com\/.*apikey=k/);
  });
  it("marks a frost on days 8–10 as uncertain", async () => {
    const warm = { daily: { ...body.daily, temperature_2m_min: [3, 3, 3, -4] } };
    const f = await openMeteoForecast(
      { lat: 38.1, lon: -101.1 },
      ctx(() => json(warm)),
    );
    expect(nextFrostDay(f)).toMatchObject({ date: "2026-11-22", uncertain: true });
  });
});

describe("NWS", () => {
  it("pairs day highs with the following night's low, in °C", async () => {
    const f = await nwsForecast(
      { lat: 38.1, lon: -101.1 },
      ctx((u) =>
        u.includes("/points/")
          ? json({ properties: { forecast: "https://api.weather.gov/gridpoints/DDC/38,55/forecast" } })
          : json({
              properties: {
                updateTime: "2026-11-14T10:00:00Z",
                periods: [
                  {
                    startTime: "2026-11-14T06:00:00-06:00",
                    isDaytime: true,
                    temperature: 50,
                    temperatureUnit: "F",
                  },
                  {
                    startTime: "2026-11-14T18:00:00-06:00",
                    isDaytime: false,
                    temperature: 28,
                    temperatureUnit: "F",
                  },
                  {
                    startTime: "2026-11-15T06:00:00-06:00",
                    isDaytime: true,
                    temperature: 41,
                    temperatureUnit: "F",
                  },
                ],
              },
            }),
      ),
    );
    expect(f.days[0]).toMatchObject({ date: "2026-11-14", tmaxC: 10, tminC: null, forecastDay: 1 });
    expect(f.days[1]).toMatchObject({ date: "2026-11-15", tmaxC: 5, tminC: -2.2, forecastDay: 2 });
    expect(nextFrostDay(f)?.date).toBe("2026-11-15");
  });
});
