import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadUaYields, oblastYields } from "./index.js";

const DATA = fileURLToPath(new URL("../../../data/", import.meta.url));

describe("ua-yields.json", () => {
  const file = loadUaYields(DATA);

  it("loads, is never marked verified, and carries its citation", () => {
    expect(file).not.toBeNull();
    expect(file!.verified).toBe(false);
    expect(file!.source.datasetUrl).toContain("data.gov.ua");
    expect(Object.keys(file!.oblasts)).toHaveLength(24);
  });

  it("has yields in the right unit for every oblast and crop (t/ha; catches a c/ha mix-up, war-hit oblasts run low)", () => {
    const limits: Record<string, [number, number]> = {
      cereals: [0.8, 10],
      sugar_beet: [10, 90],
      sunflower: [0.5, 5],
      soybean: [0.2, 4.5],
      rapeseed: [0.5, 5],
      potato: [6, 40],
    };
    for (const o of Object.values(file!.oblasts))
      for (const [crop, series] of Object.entries(o.yieldTHa))
        for (const v of Object.values(series)) {
          const [lo, hi] = limits[crop]!;
          expect(v, `${o.en} ${crop}`).toBeGreaterThanOrEqual(lo);
          expect(v, `${o.en} ${crop}`).toBeLessThanOrEqual(hi);
        }
  });

  it("finds the oblast by ISO 3166-2 code, including the ones SSSU numbers differently", () => {
    expect(oblastYields(file!, "UA-53")?.oblast.en).toBe("Poltava");
    expect(oblastYields(file!, "UA-09")?.oblast.en).toBe("Luhansk");
    expect(oblastYields(file!, "UA-77")?.oblast.en).toBe("Chernivtsi");
    expect(oblastYields(file!, "US-KS")).toBeNull();
    expect(oblastYields(file!, null)).toBeNull();
  });

  it("averages the last five published years", () => {
    const poltava = oblastYields(file!, "UA-53")!;
    const cereals = poltava.yields.find((y) => y.crop === "cereals")!;
    expect(cereals.years.length).toBeLessThanOrEqual(5);
    expect(cereals.years.at(-1)).toBe(cereals.latestYear);
    expect(poltava.verified).toBe(false);
  });

  it("returns null for a missing directory instead of throwing", () => {
    expect(loadUaYields("/nonexistent")).toBeNull();
  });
});
