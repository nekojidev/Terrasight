import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkLibrary,
  loadLibrary,
  matchRegion,
  missingPrices,
  normaliseAdminCode,
  type PestModel,
} from "./index.js";

const DATA = fileURLToPath(new URL("../../../data/", import.meta.url));

interface Point {
  name: string;
  admin: string;
  lat: number;
  lon: number;
  region: string | null;
}
const points: Point[] = JSON.parse(readFileSync(`${DATA}region-test-points.json`, "utf8")).points;

describe("loadLibrary", () => {
  const lib = loadLibrary(DATA);

  it("loads the real library files", () => {
    expect(lib.rotations.rotations).toHaveLength(113);
    expect(Object.keys(lib.rotations.regions)).toHaveLength(24);
    expect(lib.pests.pests).toHaveLength(62);
    expect(lib.pestModels.models.map((m) => m.pest)).toEqual([
      "western_corn_rootworm",
      "barley_yellow_dwarf",
      "wheat_streak_mosaic",
    ]);
  });

  it("exposes a content hash per file", () => {
    for (const v of Object.values(lib.versions)) expect(v).toMatch(/^[0-9a-f]{12}$/);
  });

  it("enables no model until its thresholds are verified", () => {
    expect(lib.enabledModels).toEqual([]);
  });

  it("lists crops without prices while prices.json is empty", () => {
    expect(missingPrices(lib)["us-southern-plains"]).toContain("corn");
  });

  it("rejects an invalid data directory with every problem listed", () => {
    expect(() => loadLibrary("/nonexistent")).toThrow(/cannot read/);
  });
});

describe("verification gate (RFC §11.3)", () => {
  const lib = loadLibrary(DATA);
  const rootworm = lib.pestModels.models[0] as PestModel;

  it("blocks an enabled model with an unverified threshold", () => {
    const models = [{ ...rootworm, enabled: true }];
    const { problems, enabledModels } = checkLibrary({ ...lib, pestModels: { version: 1, models } });
    expect(enabledModels).toEqual([]);
    expect(problems.join("\n")).toMatch(/repeatSeasons is not verified, valued and cited/);
  });

  it("accepts an enabled model whose thresholds are verified and cited", () => {
    const verified = {
      ...rootworm,
      enabled: true,
      thresholds: {
        repeatSeasons: {
          value: 1,
          unit: "seasons",
          verified: true,
          source: {
            title: "T",
            publisher: "P",
            url: "https://example.org",
            accessed: "2026-11-14",
            appliesTo: [],
          },
          verifiedBy: "team member",
          verifiedAt: "2026-11-14",
          reviewedBy: null,
        },
      },
    };
    const { problems, enabledModels } = checkLibrary({
      ...lib,
      pestModels: { version: 1, models: [verified] },
    });
    expect(problems).toEqual([]);
    expect(enabledModels).toHaveLength(1);
  });

  it("reports a tree reference to a missing threshold", () => {
    const broken = { ...rootworm, thresholds: {} };
    const { problems } = checkLibrary({ ...lib, pestModels: { version: 1, models: [broken] } });
    expect(problems.join("\n")).toMatch(/missing threshold repeatSeasons/);
  });
});

describe("matchRegion (RFC §6.3)", () => {
  const { rotations } = loadLibrary(DATA);

  it.each(points)("$name → $region", (p) => {
    expect(matchRegion(rotations, p.admin, p.lat, p.lon)).toBe(p.region);
  });

  it("has at least one known point for every library region", () => {
    const covered = new Set(points.map((p) => p.region));
    for (const id of Object.keys(rotations.regions)) expect(covered).toContain(id);
  });

  it("maps outdated ISO codes before matching", () => {
    expect(normaliseAdminCode("cn-13")).toBe("CN-HE");
    expect(matchRegion(rotations, "CN-13", 38.04, 114.51)).toBe("cn-north-china-plain");
  });
});
