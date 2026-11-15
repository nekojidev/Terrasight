import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blocksCrops, landSuitability, lccNotSuitedShare, type LandSuitabilityConfig } from "./index.js";

const cfg = JSON.parse(
  readFileSync(new URL("../../../data/land-suitability.json", import.meta.url), "utf8"),
) as LandSuitabilityConfig;

const cover = (shares: Record<string, number>, n = 3) => ({
  source: "test",
  seasons: Array.from({ length: n }, (_, i) => ({ year: 2021 + i, shares })),
});

describe("data/land-suitability.json", () => {
  it("every threshold has a source and is verified by the owner; unsourced ones are mvpDefault", () => {
    const walk = (n: unknown, path: string): void => {
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (typeof o.verified === "boolean") {
        expect(o.verified, path).toBe(true);
        expect(o.verifiedBy, path).toBe("Oleksandr Baranovskyi");
        expect(o.verifiedOn, path).toBe("2026-11-15");
        expect((o.source as { url?: string }).url, path).toMatch(/^https:/);
        return;
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(cfg, "cfg");
    expect(cfg.slope.limitedPct.mvpDefault).toBe(true);
    expect(cfg.lcc.notSuitedFromClass.mvpDefault).toBeUndefined();
  });
});

describe("landSuitability", () => {
  it("is unknown when nothing could be checked, and never blocks", () => {
    const r = landSuitability({}, cfg);
    expect(r.status).toBe("unknown");
    expect(blocksCrops(r, null)).toBe(false);
  });

  it("is suitable when every available check passes", () => {
    const r = landSuitability(
      {
        slopePct: 3,
        lcc: { nonIrrigated: [{ cls: 4, share: 1 }], irrigated: [] },
        landCover: cover({ crops: 0.9, rangeland: 0.1 }),
        soil: { coarseFragmentsPct: 10, ph: 6.8, sandPct: 30, ocGPerKg: 14 },
        ndviPeaks: [0.8, 0.7, 0.75, 0.8, 0.7, 0.6],
      },
      cfg,
    );
    expect(r).toMatchObject({ status: "suitable", reasons: [] });
    expect(r.checked).toEqual(["lcc", "land_cover", "slope", "coarse_fragments", "ph", "sandy", "ndvi"]);
  });

  describe("land capability class", () => {
    it("classes I-IV are fine, V-VIII are not", () => {
      expect(lccNotSuitedShare([{ cls: 4, share: 1 }], 5)).toBe(0);
      expect(lccNotSuitedShare([{ cls: 6, share: 0.7 }, { cls: 2, share: 0.3 }], 5)).toBeCloseTo(0.7);
      expect(lccNotSuitedShare([], 5)).toBeNull();
    });
    it("unsuitable at 60 % in V-VIII, limited at 30 %", () => {
      const u = landSuitability({ lcc: { nonIrrigated: [{ cls: 7, share: 0.65 }, { cls: 3, share: 0.35 }], irrigated: [] } }, cfg);
      expect(u.status).toBe("unsuitable");
      expect(u.reasons[0]).toMatchObject({ code: "lcc_not_suited", level: "unsuitable", value: 65, threshold: 60 });
      const l = landSuitability({ lcc: { nonIrrigated: [{ cls: 5, share: 0.4 }, { cls: 3, share: 0.6 }], irrigated: [] } }, cfg);
      expect(l.status).toBe("limited");
    });
    it("uses the irrigated classes on an irrigated field when SSURGO has them", () => {
      const lcc = { nonIrrigated: [{ cls: 6, share: 1 }], irrigated: [{ cls: 2, share: 1 }] };
      expect(landSuitability({ lcc, irrigated: true }, cfg).status).toBe("suitable");
      expect(landSuitability({ lcc, irrigated: false }, cfg).status).toBe("unsuitable");
    });
  });

  describe("land cover", () => {
    it("mostly built-up land is unsuitable and names the dominant class", () => {
      const r = landSuitability({ landCover: cover({ built: 0.7, crops: 0.2, rangeland: 0.1 }) }, cfg);
      expect(r.status).toBe("unsuitable");
      expect(r.reasons[0]).toMatchObject({ code: "land_cover_not_farmland", detail: "built", value: 70 });
      expect(r.share?.landCover?.built).toBe(0.7);
    });
    it("water + trees add up; rangeland and crops do not count", () => {
      expect(landSuitability({ landCover: cover({ water: 0.3, trees: 0.35, crops: 0.35 }) }, cfg).status).toBe("unsuitable");
      expect(landSuitability({ landCover: cover({ rangeland: 0.9, crops: 0.1 }) }, cfg).status).toBe("suitable");
    });
    it("a third non-farm is only limited (check the boundary)", () => {
      const r = landSuitability({ landCover: cover({ flooded: 0.35, crops: 0.65 }) }, cfg);
      expect(r.status).toBe("limited");
      expect(r.reasons[0]!.detail).toBe("flooded");
    });
    it("averages the latest seasons so one odd year does not decide", () => {
      const seasons = [
        { year: 2021, shares: { crops: 1 } },
        { year: 2022, shares: { crops: 1 } },
        { year: 2023, shares: { built: 1 } },
      ];
      expect(landSuitability({ landCover: { source: "t", seasons } }, cfg).status).toBe("limited");
    });
  });

  describe("slope", () => {
    it("limited above 15 %, unsuitable above 25 %", () => {
      expect(landSuitability({ slopePct: 15 }, cfg).status).toBe("suitable");
      expect(landSuitability({ slopePct: 16 }, cfg).status).toBe("limited");
      expect(landSuitability({ slopePct: 25.1 }, cfg).status).toBe("unsuitable");
    });
  });

  describe("soil", () => {
    it("coarse fragments: limited above 35 %, unsuitable above 70 %", () => {
      expect(landSuitability({ soil: { coarseFragmentsPct: 36 } }, cfg).status).toBe("limited");
      expect(landSuitability({ soil: { coarseFragmentsPct: 71 } }, cfg).status).toBe("unsuitable");
    });
    it("extreme pH is limited on both sides", () => {
      expect(landSuitability({ soil: { ph: 4.2 } }, cfg).reasons[0]!.code).toBe("ph_low");
      expect(landSuitability({ soil: { ph: 9.3 } }, cfg).reasons[0]!.code).toBe("ph_high");
      expect(landSuitability({ soil: { ph: 5 } }, cfg).status).toBe("suitable");
    });
    it("very sandy soil is limited only together with very low carbon", () => {
      expect(landSuitability({ soil: { sandPct: 90, ocGPerKg: 3 } }, cfg).status).toBe("limited");
      expect(landSuitability({ soil: { sandPct: 90, ocGPerKg: 12 } }, cfg).status).toBe("suitable");
      expect(landSuitability({ soil: { sandPct: 60, ocGPerKg: 3 } }, cfg).status).toBe("suitable");
    });
    it("a very shallow soil (SSURGO) is limited", () => {
      expect(landSuitability({ soil: { bedrockDepthCm: 20 } }, cfg).status).toBe("limited");
    });
  });

  describe("NDVI", () => {
    it("never reaching a crop-like peak in 5+ seasons is limited", () => {
      const r = landSuitability({ ndviPeaks: [0.3, 0.35, 0.3, 0.25, 0.38, null] }, cfg);
      expect(r.status).toBe("limited");
      expect(r.reasons[0]).toMatchObject({ code: "ndvi_never_crop", value: 0.38, detail: "5" });
    });
    it("one crop-like season is enough, and too few seasons prove nothing", () => {
      expect(landSuitability({ ndviPeaks: [0.3, 0.3, 0.3, 0.3, 0.6] }, cfg).status).toBe("suitable");
      expect(landSuitability({ ndviPeaks: [0.3, 0.3] }, cfg).status).toBe("unknown");
    });
  });

  describe("combinations", () => {
    it("the worst reason decides and all reasons are listed", () => {
      const r = landSuitability(
        { slopePct: 18, landCover: cover({ water: 0.8, crops: 0.2 }), soil: { ph: 4 } },
        cfg,
      );
      expect(r.status).toBe("unsuitable");
      expect(r.reasons.map((x) => x.code).sort()).toEqual(["land_cover_not_farmland", "ph_low", "slope_steep"]);
    });
    it("every reason carries its source and the mvpDefault flag", () => {
      const r = landSuitability({ slopePct: 18, soil: { ph: 4 } }, cfg);
      const slope = r.reasons.find((x) => x.code === "slope_steep")!;
      const ph = r.reasons.find((x) => x.code === "ph_low")!;
      expect(slope).toMatchObject({ mvpDefault: true, verified: true });
      expect(slope.source).toContain("FAO");
      expect(ph.mvpDefault).toBe(false);
      expect(ph.sourceUrl).toMatch(/^https:/);
    });
  });

  describe("override", () => {
    it("blocks crops only while unsuitable and not overridden", () => {
      const u = landSuitability({ slopePct: 40 }, cfg);
      expect(blocksCrops(u, null)).toBe(true);
      expect(blocksCrops(u, { userId: "u", at: "2026-11-15T00:00:00Z" })).toBe(false);
      expect(blocksCrops(landSuitability({ slopePct: 20 }, cfg), null)).toBe(false);
      expect(blocksCrops(null, null)).toBe(false);
    });
  });
});
