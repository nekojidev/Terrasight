import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { landChip } from "../brief/brief.service.js";
import { FieldsService } from "../fields/fields.service.js";
import {
  assertCropAllowed,
  assertNotBlocked,
  buildSuitabilityInputs,
  compute,
  loadSuitabilityConfig,
  suitabilityView,
} from "./suitability.js";

const DATA_DIR = fileURLToPath(new URL("../../../../data/", import.meta.url));
const cfg = loadSuitabilityConfig(DATA_DIR);
const now = new Date("2026-11-15T10:00:00Z");

describe("buildSuitabilityInputs", () => {
  it("uses the Esri land cover outside the US and the CDL classes in the US", () => {
    const esri = buildSuitabilityInputs({
      cropland: {
        product: "Esri",
        seasons: [
          { year: 2022, cropShare: 0.1, n: 10, shares: { built: 0.9, crops: 0.1 } },
          { year: 2023, cropShare: 0.1, n: 10 }, // an old cache entry without shares is ignored
        ],
      },
    });
    expect(esri.landCover).toEqual({ source: "Esri", seasons: [{ year: 2022, shares: { built: 0.9, crops: 0.1 } }] });
    const cdl = buildSuitabilityInputs({
      cdl: {
        seasons: [
          { year: 2023, classes: [{ code: 111, share: 0.8 }, { code: 1, share: 0.2 }], majorityCode: 111, majorityShare: 0.8, method: "pixels", n: 5 },
        ],
      },
    });
    expect(cdl.landCover!.seasons[0]).toEqual({ year: 2023, shares: { water: 0.8, crops: 0.2 } });
    expect(buildSuitabilityInputs({}).landCover).toBeNull();
  });

  it("takes capability class and bedrock from SSURGO, coarse fragments, pH and sand from SoilGrids", () => {
    const i = buildSuitabilityInputs({
      irrigated: true,
      slopePct: 4,
      ssurgo: { awsMm: 1, hydrologicGroup: "B", drainageClass: null, slopePct: 1, mapUnits: [], bedrockDepthCm: 18, capability: { nonIrrigated: [{ cls: 6, share: 1 }], irrigated: [] } },
      grids: { clayPct: 10, sandPct: 90, siltPct: 0, ocGPerKg: 3, ph: 7, cfvoPct: 40 },
      ndviPeaks: [0.5, null],
    });
    expect(i).toMatchObject({
      irrigated: true,
      slopePct: 4,
      lcc: { nonIrrigated: [{ cls: 6, share: 1 }] },
      soil: { coarseFragmentsPct: 40, ph: 7, sandPct: 90, ocGPerKg: 3, bedrockDepthCm: 18 },
      ndviPeaks: [0.5, null],
    });
  });
});

describe("compute and the stored view", () => {
  it("is unknown without data and never blocks", () => {
    const s = compute({}, cfg, now);
    expect(s).toMatchObject({ status: "unknown", computedAt: now.toISOString() });
    expect(suitabilityView(s, null)).toMatchObject({ status: "unknown", blocked: false, override: null });
  });

  it("unsuitable blocks until an override with who and when exists", () => {
    const s = compute({ slopePct: 40 }, cfg, now);
    expect(suitabilityView(s, null)).toMatchObject({ status: "unsuitable", blocked: true });
    const ov = { userId: "u1", userName: "Olena", at: "2026-11-15T10:05:00Z" };
    expect(suitabilityView(s, ov)).toMatchObject({ status: "unsuitable", blocked: false, override: ov });
  });

  it("limited never blocks; a missing column is just null", () => {
    expect(suitabilityView(compute({ slopePct: 20 }, cfg, now), null)).toMatchObject({ status: "limited", blocked: false });
    expect(suitabilityView(null, null)).toBeNull();
  });
});

describe("brief and list chips", () => {
  it("only unsuitable, limited and overridden land gets a chip", () => {
    expect(landChip(compute({ slopePct: 40 }, cfg, now), null)).toBe("unsuitable");
    expect(landChip(compute({ slopePct: 40 }, cfg, now), { userId: "u", at: "x" })).toBe("overridden");
    expect(landChip(compute({ slopePct: 20 }, cfg, now), null)).toBe("limited");
    expect(landChip(compute({ slopePct: 2 }, cfg, now), null)).toBeNull();
    expect(landChip(null, null)).toBeNull();
  });
});

describe("assertCropAllowed", () => {
  const db = (suitability: unknown, suitabilityOverride: unknown = null) => ({
    field: { findUnique: async () => ({ suitability, suitabilityOverride }) },
  });
  it("is a 409 for unsuitable land, fine once overridden or when limited / unknown", async () => {
    const unsuitable = compute({ slopePct: 40 }, cfg, now);
    await expect(assertCropAllowed(db(unsuitable), "f")).rejects.toMatchObject({ status: 409 });
    await expect(assertCropAllowed(db(unsuitable, { userId: "u", at: "x" }), "f")).resolves.toBeUndefined();
    await expect(assertCropAllowed(db(compute({ slopePct: 20 }, cfg, now)), "f")).resolves.toBeUndefined();
    await expect(assertCropAllowed(db(null), "f")).resolves.toBeUndefined();
  });
});

describe("assertNotBlocked (season suggestions, season record crop, plan save)", () => {
  it("throws the land-unsuitable problem only for unsuitable, not overridden land", () => {
    const unsuitable = compute({ slopePct: 40 }, cfg, now);
    expect(() => assertNotBlocked(unsuitable, null)).toThrowError(
      expect.objectContaining({ status: 409 }) as unknown as Error,
    );
    expect(() => assertNotBlocked(unsuitable, { userId: "u", at: "x" })).not.toThrow();
    expect(() => assertNotBlocked(compute({ slopePct: 20 }, cfg, now), null)).not.toThrow();
    expect(() => assertNotBlocked(undefined, undefined)).not.toThrow();
  });
});

describe("add-field preview", () => {
  const place = (country: string) => ({
    areaHa: 12,
    centroid: { lon: -100, lat: 38 },
    placeLabel: "Somewhere",
    adminCode: "US-KS",
    country,
    regionId: null,
    tier: "A",
    multipolygon: [[[[-100, 38], [-99.99, 38], [-99.99, 38.01], [-100, 38]]]],
    bbox: [-100, 38, -99.99, 38.01],
  });
  const service = (country: string, ssurgoPayload: unknown) =>
    new FieldsService(
      {} as never,
      { place: async () => place(country) } as never,
      {
        applicable: () => [{ id: "ssurgo" }],
        adapter: () => ({ fetch: async () => ({ status: "done", payload: ssurgoPayload }) }),
      } as never,
      {} as never,
      { DATA_DIR } as never,
    );

  it("warns before saving when most of the US outline is land capability class V-VIII", async () => {
    const p = await service("US", {
      capability: { nonIrrigated: [{ cls: 7, share: 0.8 }, { cls: 2, share: 0.2 }], irrigated: [] },
    }).preview({ type: "Polygon", coordinates: [] } as never);
    expect(p.suitability).toMatchObject({ status: "unsuitable" });
    expect(p.suitability!.reasons[0]).toMatchObject({ code: "lcc_not_suited", value: 80 });
  });

  it("is simply unknown (never an error) when the quick check has nothing or fails", async () => {
    const empty = await service("US", { mapUnits: [] }).preview({} as never);
    expect(empty.suitability).toMatchObject({ status: "unknown" });
    const failing = new FieldsService(
      {} as never,
      { place: async () => place("US") } as never,
      {
        applicable: () => [],
        adapter: () => ({
          fetch: async () => {
            throw new Error("SDA down");
          },
        }),
      } as never,
      {} as never,
      { DATA_DIR } as never,
    );
    expect((await failing.preview({} as never)).suitability).toBeNull();
  });
});
