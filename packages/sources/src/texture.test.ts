import { describe, expect, it } from "vitest";
import { soilFromTexture, textureClass } from "./texture.js";

describe("SoilGrids texture to soil inputs (tier B/C)", () => {
  it("classifies typical Ukrainian soils", () => {
    expect(textureClass(20, 25, 55)).toBe("silt loam"); // chernozem-like
    expect(textureClass(5, 85, 10)).toBe("loamy sand"); // Polissia sand
    expect(textureClass(8, 70, 22)).toBe("sandy loam");
  });
  it("gives water capacity and a hydrologic group, or null without texture", () => {
    expect(soilFromTexture({ clayPct: 20, sandPct: 25, siltPct: 55 })).toMatchObject({
      awsMmPerM: 200,
      hydrologicGroup: "B",
    });
    expect(soilFromTexture({ clayPct: null, sandPct: 25, siltPct: 55 })).toBeNull();
  });
});
