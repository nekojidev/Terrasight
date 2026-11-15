import { describe, expect, it } from "vitest";
import { foreignScriptChar, hasForeignScript } from "./text-script.js";

describe("script guard", () => {
  it("rejects the stray Japanese characters seen in an English recommendation", () => {
    const s = "Discuss resistant hybrids with道の seed supplier";
    expect(hasForeignScript(s, "en")).toBe(true);
    expect(foreignScriptChar(s, "en")).toBe("道");
    expect(hasForeignScript(s, "uk")).toBe(true);
  });
  it("accepts clean English with numbers, units and punctuation", () => {
    expect(hasForeignScript("Scout 12 plants/m² at 28 °C (µg/L) — risk is high, café.", "en")).toBe(false);
  });
  it("rejects Cyrillic and Hangul in English", () => {
    expect(hasForeignScript("Check the поле", "en")).toBe(true);
    expect(hasForeignScript("점검 now", "en")).toBe(true);
  });
  it("accepts Ukrainian with Latin names and units, rejects CJK and Hangul", () => {
    expect(hasForeignScript("Огляньте поле Pivot 12: 5 т/га, NDVI 0,6. Є ґрунт, їжак.", "uk")).toBe(false);
    expect(hasForeignScript("Поговоріть з道の постачальником", "uk")).toBe(true);
    expect(hasForeignScript("Огляд 점검", "uk")).toBe(true);
  });
});
