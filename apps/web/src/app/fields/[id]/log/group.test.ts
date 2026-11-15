import { describe, expect, it } from "vitest";
import { cropLabel, groupBy } from "./group";

describe("log helpers", () => {
  it("groups neighbours with the same label", () => {
    const g = groupBy([1, 1, 2, 1], (n) => String(n));
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ["1", 2],
      ["2", 1],
      ["1", 1],
    ]);
  });
  it("translates a crop and never shows the key", () => {
    const names = { corn_grain: { en: "Corn", uk: "Кукурудза" } };
    expect(cropLabel("corn_grain", names, "uk", "a crop")).toBe("Кукурудза");
    expect(cropLabel("mystery_crop", names, "en", "a crop")).toBe("a crop");
    expect(cropLabel(undefined, names, "en", "a crop")).toBe("a crop");
  });
});
