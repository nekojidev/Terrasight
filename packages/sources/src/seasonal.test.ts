import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openMeteoSeasonal, parseSeasonal } from "./seasonal.js";

/** Real response recorded 2026-11-15 (Garden City, KS), trimmed to 12 members × 10 days. */
const recorded = JSON.parse(readFileSync(new URL("./seasonal.fixture.json", import.meta.url), "utf8")) as {
  daily: Record<string, unknown>;
  monthly: Record<string, unknown>;
};
const ctx = (f: (url: string) => Response) => ({
  signal: new AbortController().signal,
  fetch: (async (u: string | URL) => f(String(u))) as typeof fetch,
  today: "2026-11-15",
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("Open-Meteo seasonal", () => {
  it("reads the control run and the members, and the monthly anomalies", () => {
    const e = parseSeasonal(recorded, { lat: 38.1, lon: -101.1 }, "2026-11-15");
    expect(e.tmaxC).toHaveLength(12);
    expect(e.dates).toHaveLength(10);
    expect(e.dates[0]).toBe("2026-11-15");
    expect(e.monthly.months.slice(0, 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(e.monthly.precipAnomalyMm[1]).toBeCloseTo(7.9, 1);
    expect(e.attribution).toContain("CC BY 4.0");
  });

  it("uses the free host without a key and the customer host with one", async () => {
    const urls: string[] = [];
    const c = ctx((u) => (urls.push(u), json(recorded)));
    await openMeteoSeasonal({ lat: 38.1, lon: -101.1 }, 106, c);
    await openMeteoSeasonal({ lat: 38.1, lon: -101.1 }, 400, c, "k");
    expect(urls[0]).toContain("https://seasonal-api.open-meteo.com/v1/seasonal");
    expect(urls[0]).toContain("forecast_days=106");
    expect(urls[1]).toContain("customer-seasonal-api.open-meteo.com");
    expect(urls[1]).toContain("forecast_days=217"); // the API's maximum
  });

  it("rejects an empty or member-less answer", () => {
    expect(() => parseSeasonal({ daily: { time: [] } }, { lat: 0, lon: 0 }, "2026-11-15")).toThrow();
    expect(() =>
      parseSeasonal(
        { daily: { time: ["2026-11-15"], temperature_2m_max: [1], temperature_2m_min: [0], precipitation_sum: [0] } },
        { lat: 0, lon: 0 },
        "2026-11-15",
      ),
    ).toThrow(/members/);
  });
});
