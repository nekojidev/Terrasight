import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSoilGrids } from "./others.js";
import { clearSasCache, signHref } from "./planetary.js";
import { withRetry } from "./http.js";
import { cropShare, landCoverFromCdl, readSeasons, summariseCropland } from "./landcover.js";
import {
  cogUrl,
  ighForward,
  parseWindow,
  windowMean,
  wcsUrl,
  type LayerWindow,
} from "./soilgrids-raster.js";
import { SourceError, type FieldGeometry } from "./types.js";
import type { StacItem } from "./planetary.js";

// Recorded WCS GetCoverage (clay 0-5 cm, 3 km window in IGH metres around Cherkasy, 12 × 12 px, mostly no-data).
const WCS_TIF = readFileSync(new URL("./__fixtures__/wcs-clay-0-5cm-cherkasy.tif", import.meta.url));
const wcsBuffer = () => WCS_TIF.buffer.slice(WCS_TIF.byteOffset, WCS_TIF.byteOffset + WCS_TIF.byteLength);

const field: FieldGeometry = {
  polygons: [
    [
      [
        [32.057, 49.437],
        [32.063, 49.437],
        [32.063, 49.443],
        [32.057, 49.443],
        [32.057, 49.437],
      ],
    ],
  ],
  centroid: { lon: 32.06, lat: 49.44 },
  bbox: [32.057, 49.437, 32.063, 49.443],
  country: "UA",
};

describe("Interrupted Goode Homolosine", () => {
  it("projects like the SoilGrids grid (checked against the WCS / COG rasters)", () => {
    const [x, y] = ighForward(32.06, 49.44);
    expect(x).toBeCloseTo(3497419.3, 0);
    expect(y).toBeCloseTo(5477914.5, 0);
    const [ux, uy] = ighForward(-101.05, 38.1);
    expect(ux).toBeCloseTo(-11223930.3, 0);
    expect(uy).toBeCloseTo(4241272.6, 0);
  });

  it("is continuous across the lobe cut at the equator", () => {
    const [xa] = ighForward(-40.0001, 0);
    const [xb] = ighForward(-39.9999, 0);
    expect(Math.abs(xa - xb)).toBeLessThan(100);
  });

  it("builds WCS and COG urls", () => {
    expect(wcsUrl("clay", "0-5cm", [3497419, 5477914])).toContain("COVERAGEID=clay_0-5cm_mean");
    expect(wcsUrl("clay", "0-5cm", [3497419, 5477914])).toContain("SUBSET=x(3494419,3500419)");
    expect(cogUrl("phh2o", "60-100cm")).toBe(
      "https://files.isric.org/soilgrids/latest/data_aggregated/1000m/phh2o/phh2o_60-100cm_mean_1000.tif",
    );
  });
});

describe("WCS GeoTIFF parsing", () => {
  it("reads the recorded window and treats 0 as no-data", async () => {
    const win = await parseWindow(wcsBuffer(), (v) => v === 0);
    expect(win.width).toBe(12);
    expect(win.height).toBe(12);
    expect(win.pixel).toBe(250);
    const valid = win.values.filter((v) => v !== null);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.length).toBeLessThan(win.values.length / 2); // SoilGrids has gaps around Cherkasy
    for (const v of valid) expect(v).toBeGreaterThan(200); // clay g/kg
  });

  it("falls back to the neighbourhood when no valid pixel lies inside the field, and says so", async () => {
    const win = await parseWindow(wcsBuffer(), (v) => v === 0);
    const centre = ighForward(32.06, 49.44);
    const polygons = field.polygons.map((p) => p.map((r) => r.map(([lo, la]) => ighForward(lo!, la!))));
    const stat = windowMean(win, polygons, centre);
    expect(stat.mean).not.toBeNull();
    expect(stat.radiusM).toBeGreaterThan(0); // none inside the 600 m field
    expect(stat.mean! / 10).toBeGreaterThan(20);
    expect(stat.mean! / 10).toBeLessThan(45);
  });

  it("uses only pixels inside the field when there are some", () => {
    const win: LayerWindow = {
      originX: 0,
      originY: 1000,
      pixel: 250,
      width: 4,
      height: 4,
      values: [...Array<number | null>(15).fill(100), 400],
    };
    // field covers only the last pixel (col 3, row 3: x 750-1000, y 0-250)
    const poly = [[[[760, 10], [990, 10], [990, 240], [760, 240], [760, 10]]]];
    expect(windowMean(win, poly, [500, 500])).toEqual({ mean: 400, radiusM: 0, pixels: 1 });
  });

  it("returns null when nothing is valid within 3 km", () => {
    const win: LayerWindow = { originX: 0, originY: 1000, pixel: 250, width: 2, height: 2, values: [null, null, null, null] };
    expect(windowMean(win, [], [250, 750]).mean).toBeNull();
  });
});

describe("SoilGrids path selection", () => {
  const ctxBase = { today: "2026-11-15" };
  const restBody = {
    properties: {
      layers: ["clay", "sand", "silt", "soc", "phh2o"].map((name) => ({
        name,
        unit_measure: { d_factor: 10 },
        depths: ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"].map((label) => ({
          label,
          values: { mean: name === "clay" ? 300 : 200 },
        })),
      })),
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const makeCtx = (impl: (url: string) => Promise<Response>) => {
    const fetchMock = vi.fn((url: string | URL | Request) => impl(String(url)));
    return { ctx: { ...ctxBase, signal: new AbortController().signal, fetch: fetchMock as unknown as typeof fetch }, fetchMock };
  };
  const wcsResponse = () => new Response(wcsBuffer(), { status: 200, headers: { "content-type": "image/tiff" } });

  it("uses REST when it answers", async () => {
    const { ctx, fetchMock } = makeCtx(async () => json(restBody));
    const r = await fetchSoilGrids(field, ctx);
    expect(r.payload).toMatchObject({ clayPct: 30, via: "rest", resolutionM: 250 });
    expect(r.payload).not.toHaveProperty("fallbackReason");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the WCS on a REST 5xx, labels it, and keeps the output shape", async () => {
    const { ctx, fetchMock } = makeCtx(async (url) =>
      url.includes("rest.isric.org") ? new Response("busy", { status: 503 }) : wcsResponse(),
    );
    const r = await fetchSoilGrids(field, ctx);
    expect(r.status).toBe("done");
    expect(r.payload).toMatchObject({ via: "wcs", resolutionM: 250, fallbackReason: "REST responded 503" });
    for (const k of ["clayPct", "sandPct", "siltPct", "ocGPerKg", "ph"] as const) expect(r.payload![k]).toEqual(expect.any(Number));
    expect(r.payload!.searchRadiusM).toBeGreaterThan(0);
    expect(r.attribution).toContain("250 m");
    // 1 REST call + 30 WCS layers (5 properties + coarse fragments, 5 depths each)
    expect(fetchMock).toHaveBeenCalledTimes(1 + 30);
  });

  it("falls back when REST has no value for the exact pixel (SoilGrids gap)", async () => {
    const empty = {
      properties: { layers: restBody.properties.layers.map((l) => ({ ...l, depths: l.depths.map((d) => ({ ...d, values: { mean: null } })) })) },
    };
    const { ctx } = makeCtx(async (url) => (url.includes("rest.isric.org") ? json(empty) : wcsResponse()));
    const r = await fetchSoilGrids(field, ctx);
    expect(r.payload).toMatchObject({ via: "wcs" });
    expect(r.payload!.fallbackReason).toContain("no value for this exact pixel");
  });

  it("gives up on REST after its time limit and moves on to the WCS", async () => {
    const { ctx } = makeCtx(
      (url) =>
        url.includes("rest.isric.org")
          ? new Promise<Response>(() => undefined) // never answers; the per-request timeout aborts it
          : Promise.resolve(wcsResponse()),
    );
    // the injected fetch ignores the abort signal, so race the stage the way production does: via AbortSignal
    const slow = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).includes("rest.isric.org")
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))
        : Promise.resolve(wcsResponse()),
    );
    const r = await fetchSoilGrids(field, { ...ctx, fetch: slow as unknown as typeof fetch }, { restMs: 30 });
    expect(r.payload).toMatchObject({ via: "wcs" });
    expect(r.payload!.fallbackReason).toBe("REST did not respond in time");
  });

  it("treats an error document from the WCS as a failure of that path", async () => {
    const { ctx } = makeCtx(async (url) =>
      url.includes("rest.isric.org")
        ? new Response("x", { status: 503 })
        : new Response("<ExceptionReport/>", { status: 200, headers: { "content-type": "text/xml" } }),
    );
    await expect(fetchSoilGrids(field, ctx, { only: "wcs" })).rejects.toThrow(/WCS answered with an error/);
  });
});

describe("withRetry and SAS signing", () => {
  beforeEach(() => clearSasCache());
  const noSleep = async () => undefined;

  it("retries retryable errors with backoff and stops on non-retryable ones", async () => {
    const calls = vi.fn();
    const flaky = vi.fn(async (n: number) => {
      calls(n);
      if (n < 2) throw new SourceError("responded 429", true);
      return "ok";
    });
    await expect(withRetry(flaky, { attempts: 3, sleep: noSleep })).resolves.toBe("ok");
    expect(calls).toHaveBeenCalledTimes(3);
    const bad = vi.fn(async () => Promise.reject(new SourceError("responded 404", false)));
    await expect(withRetry(bad, { attempts: 3, sleep: noSleep })).rejects.toThrow("404");
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("shares one SAS request between concurrent readers and survives a 429", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response("slow down", { status: 429 })
        : new Response(JSON.stringify({ token: "sv=1&sig=abc", "msft:expiry": new Date(Date.now() + 3600e3).toISOString() }), { status: 200 });
    });
    const ctx = { signal: new AbortController().signal, fetch: f as unknown as typeof fetch, today: "2026-11-15" };
    const href = "https://acct.blob.core.windows.net/cont/a.tif";
    // the backoff is real here (~0.7 s) but short
    const urls = await Promise.all([1, 2, 3, 4].map(() => signHref(href, ctx)));
    expect(new Set(urls)).toEqual(new Set([`${href}?sv=1&sig=abc`]));
    expect(f).toHaveBeenCalledTimes(2); // one 429 + one success, not 4 requests
  });
});

describe("land cover seasons", () => {
  const item = (year: number, zone = "36U"): StacItem => ({
    id: `${zone}-${year}`,
    properties: { start_datetime: `${year}-01-01T00:00:00Z` },
    assets: { data: { href: "https://x/y.tif" } },
  });
  const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => item(from + i));
  const crops = [5, 5, 5, 11]; // 75 % crops
  const noSleep = { sleep: async () => undefined };

  it("computes the crop share and ignores no-data / clouds", () => {
    expect(cropShare([0, 10, 5, 7])).toEqual({ cropShare: 0.5, n: 2, shares: { crops: 0.5, built: 0.5 } });
    expect(cropShare([0, 0])).toBeNull();
  });

  it("US land cover from the CDL histogram: developed, water, wetland, forest and barren are not farmland", () => {
    const cdl = {
      seasons: [
        {
          year: 2023,
          classes: [
            { code: 122, share: 0.4 },
            { code: 123, share: 0.2 },
            { code: 111, share: 0.1 },
            { code: 176, share: 0.1 },
            { code: 1, share: 0.2 },
          ],
          majorityCode: 122,
          majorityShare: 0.4,
          method: "pixels" as const,
          n: 100,
        },
      ],
    };
    expect(landCoverFromCdl(cdl)).toEqual([
      { year: 2023, shares: { built: 0.6, water: 0.1, rangeland: 0.1, crops: 0.2 } },
    ]);
  });

  it("all seasons read: done with no reason", async () => {
    const out = await readSeasons(years(2017, 2023), async () => crops, { retry: noSleep });
    const r = summariseCropland(out);
    expect(r.status).toBe("done");
    expect(r.reason).toBeUndefined();
    expect(r.payload!.seasons).toHaveLength(7);
    expect(r.payload!.seasons[0]).toMatchObject({ year: 2017, cropShare: 0.75 });
  });

  it("a transient read error is retried and the season is recovered", async () => {
    let fails = 2;
    const read = vi.fn(async (it: StacItem) => {
      if (it.id.endsWith("2019") && fails-- > 0) throw new Error("Error fetching data.");
      return crops;
    });
    const r = summariseCropland(await readSeasons(years(2017, 2023), read, { retry: noSleep }));
    expect(r.status).toBe("done");
    expect(r.payload!.seasons).toHaveLength(7);
    expect(read).toHaveBeenCalledTimes(9);
  });

  it("a year without a product item is 'no data for <year>', not an error", async () => {
    const items = years(2017, 2023).filter((i) => !i.id.endsWith("2017"));
    const r = summariseCropland(await readSeasons(items, async () => crops, { retry: noSleep }));
    expect(r.status).toBe("done");
    expect(r.reason).toBe("no data for 2017");
    expect(r.payload!.noDataYears).toEqual([2017]);
  });

  it("a season whose pixels are all no-data / clouds is 'no data', not a failure", async () => {
    const r = summariseCropland(
      await readSeasons(years(2017, 2023), async (it) => (it.id.endsWith("2020") ? [0, 0, 10] : crops), { retry: noSleep }),
    );
    expect(r.status).toBe("done");
    expect(r.reason).toBe("no data for 2020");
  });

  it("only real read failures make it partial, naming the exact years", async () => {
    const read = async (it: StacItem) => {
      if (it.id.endsWith("2018") || it.id.endsWith("2021")) throw new Error("Error fetching data.");
      if (it.id.endsWith("2017")) return [0];
      return crops;
    };
    const r = summariseCropland(await readSeasons(years(2017, 2023), read, { retry: noSleep }));
    expect(r.status).toBe("partial");
    expect(r.reason).toBe("2 season(s) could not be read: 2018, 2021; no data for 2017");
    expect(r.payload!.seasons.map((s) => s.year)).toEqual([2019, 2020, 2022, 2023]);
  });

  it("a field on a tile border merges the tiles of one year", async () => {
    const items = [item(2022, "36U"), item(2022, "36T")];
    const read = async (it: StacItem) => (it.id.startsWith("36U") ? [5, 5] : [7, 7]);
    const out = await readSeasons(items, read, { retry: noSleep });
    expect(out.find((o) => o.year === 2022)).toMatchObject({ state: "ok", cropShare: 0.5, n: 4 });
  });

  it("no season readable: retryable error when reads failed, plain error when there is simply no data", async () => {
    const failed = await readSeasons(years(2017, 2023), async () => Promise.reject(new Error("boom")), { retry: noSleep });
    expect(() => summariseCropland(failed)).toThrow(/could not read land cover for 2017, 2018/);
    try {
      summariseCropland(failed);
    } catch (e) {
      expect((e as SourceError).retryable).toBe(true);
    }
    const none = await readSeasons([], async () => crops, { retry: noSleep });
    try {
      summariseCropland(none);
      expect.unreachable();
    } catch (e) {
      expect((e as SourceError).retryable).toBe(false);
    }
  });
});
