import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchCountyYields, nassCacheKey, NASS_CROPS, parseCountyYields, stripKey, toTPerHa } from "./nass.js";

const rec = (over: Record<string, unknown>) => ({
  year: 2022,
  Value: "147.6",
  prodn_practice_desc: "ALL PRODUCTION PRACTICES",
  class_desc: "ALL CLASSES",
  util_practice_desc: "GRAIN",
  unit_desc: "BU / ACRE",
  county_name: "FINNEY",
  state_alpha: "KS",
  ...over,
});

const json = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("unit conversion", () => {
  it("bushels per acre use the legal bushel weight of each crop", () => {
    // 100 bu/ac: corn/sorghum 56 lb, wheat/soybeans 60 lb; x 0.45359237 kg/lb / 0.40468564224 ha/ac
    expect(toTPerHa("100", NASS_CROPS.corn!)).toBeCloseTo(6.277, 3);
    expect(toTPerHa("100", NASS_CROPS.sorghum!)).toBeCloseTo(6.277, 3);
    expect(toTPerHa("100", NASS_CROPS.winter_wheat!)).toBeCloseTo(6.725, 3);
    expect(toTPerHa("100", NASS_CROPS.soybean!)).toBeCloseTo(6.725, 3);
  });
  it("pounds and short tons per acre", () => {
    expect(toTPerHa("1000", NASS_CROPS.cotton!)).toBeCloseTo(1.121, 3);
    expect(toTPerHa("1500", NASS_CROPS.sunflower!)).toBeCloseTo(1.681, 3);
    expect(toTPerHa("4", NASS_CROPS.alfalfa!)).toBeCloseTo(8.967, 3);
  });
  it("thousands separators are read", () => {
    expect(toTPerHa("1,000", NASS_CROPS.cotton!)).toBeCloseTo(1.121, 3);
  });
});

describe("withheld values", () => {
  it("(D), (NA), (Z) and empty are missing, never zero", () => {
    for (const v of ["(D)", "(NA)", "(Z)", "", " "]) expect(toTPerHa(v, NASS_CROPS.corn!)).toBeNull();
  });
  it("parse keeps the withheld year with tPerHa null", () => {
    const r = parseCountyYields([rec({ Value: "(D)", year: 2021 }), rec({})], "corn", "KS");
    if (!r.connected || !r.ok) throw new Error("expected ok");
    expect(r.rows.find((x) => x.year === 2021)?.tPerHa).toBeNull();
    expect(r.rows.find((x) => x.year === 2022)?.tPerHa).toBeCloseTo(9.265, 3);
  });
});

describe("parsing", () => {
  it("separates practices and drops other classes, utilisations and sub-practices", () => {
    const r = parseCountyYields(
      [
        rec({ prodn_practice_desc: "IRRIGATED", Value: "198.9" }),
        rec({ prodn_practice_desc: "NON-IRRIGATED", Value: "50.1" }),
        rec({ util_practice_desc: "SILAGE" }),
        rec({ prodn_practice_desc: "IRRIGATED, FULL" }),
        rec({ unit_desc: "TONS / ACRE" }),
      ],
      "corn",
      "KS",
    );
    if (!r.connected || !r.ok) throw new Error("expected ok");
    expect(r.rows.map((x) => x.practice).sort()).toEqual(["irrigated", "non-irrigated"]);
    expect(r.area).toBe("Finney County, KS");
  });
  it("reads the recorded Finney County corn series", () => {
    const f = new URL("../../../fixtures/nass/KS-20055-corn.json", import.meta.url);
    const r = JSON.parse(readFileSync(f, "utf8"));
    const y2022 = r.rows.find((x: { year: number; practice: string }) => x.year === 2022 && x.practice === "all");
    expect(r.area).toBe("Finney County, KS");
    expect(y2022.raw).toBe("147.6");
    expect(y2022.tPerHa).toBeCloseTo(9.265, 3);
  });
});

describe("fetchCountyYields", () => {
  it("without a key it is not connected and does not call out", async () => {
    let called = false;
    const r = await fetchCountyYields(
      { stateAlpha: "KS", countyName: "Finney", crop: "corn" },
      {
        fetch: (async () => {
          called = true;
          return new Response("{}");
        }) as unknown as typeof fetch,
      },
    );
    expect(r.connected).toBe(false);
    expect(called).toBe(false);
  });
  it("narrows the query by splitting the years when NASS says it exceeds the limit", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      const u = new URL(url);
      calls.push(`${u.searchParams.get("year__GE")}-${u.searchParams.get("year__LE")}`);
      const from = Number(u.searchParams.get("year__GE"));
      const to = Number(u.searchParams.get("year__LE"));
      if (to - from > 10) return new Response(JSON.stringify({ error: ["exceeds limit=50000"] }), { status: 400 });
      return new Response(JSON.stringify({ data: [rec({ year: from })] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchCountyYields(
      { stateAlpha: "KS", countyName: "Finney County", crop: "corn", fromYear: 1981, toYear: 2025 },
      { apiKey: "SECRET", fetch: f },
    );
    if (!r.connected || !r.ok) throw new Error("expected ok");
    expect(calls.length).toBeGreaterThan(1);
    expect(r.rows.length).toBeGreaterThan(1);
  });
  it("empty data, 400 no-match and a rejected key never throw", async () => {
    const q = { stateAlpha: "KS", countyName: "Finney", crop: "corn" };
    const empty = await fetchCountyYields(q, { apiKey: "K", fetch: json(200, { data: [] }) });
    expect(empty).toMatchObject({ connected: true, ok: true, rows: [] });
    const none = await fetchCountyYields(q, { apiKey: "K", fetch: json(400, { error: ["bad request - invalid query"] }) });
    expect(none).toMatchObject({ ok: true, rows: [] });
    const bad = await fetchCountyYields(q, { apiKey: "K", fetch: json(401, { error: ["unauthorized"] }) });
    expect(bad).toMatchObject({ connected: true, ok: false });
  });
  it("a timeout or network error is a failed result and the key is not in the message", async () => {
    const f = (async (url: string) => {
      throw new Error(`connect failed for ${url}`);
    }) as unknown as typeof fetch;
    const r = await fetchCountyYields(
      { stateAlpha: "KS", countyName: "Finney", crop: "corn" },
      { apiKey: "SECRET123", fetch: f },
    );
    expect(r).toMatchObject({ connected: true, ok: false });
    expect(JSON.stringify(r)).not.toContain("SECRET123");
  });
  it("a crop without a NASS series is reported, not guessed", async () => {
    const r = await fetchCountyYields({ stateAlpha: "KS", countyName: "Finney", crop: "forage_sorghum" }, { apiKey: "K" });
    expect(r).toMatchObject({ connected: true, ok: false });
  });
});

describe("cache key", () => {
  it("has no API key and no date, and is the same for name spelling variants", () => {
    const a = nassCacheKey({ stateAlpha: "ks", countyFips: "20055", crop: "corn" });
    expect(a).toBe("nass:yield:v1:KS:fips:20055:corn");
    expect(nassCacheKey({ stateAlpha: "KS", countyName: "Finney County", crop: "corn" })).toBe(
      nassCacheKey({ stateAlpha: "KS", countyName: "finney", crop: "corn" }),
    );
    expect(a).not.toMatch(/key|20\d\d-/i);
  });
  it("stripKey removes the key parameter and the literal key", () => {
    expect(stripKey("https://x/?a=1&key=ABC&b=2", "ABC")).toBe("https://x/?a=1&key=***&b=2");
    expect(stripKey("oops ABC", "ABC")).toBe("oops ***");
  });
});
