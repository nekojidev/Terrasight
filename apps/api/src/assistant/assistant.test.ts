import { describe, expect, it } from "vitest";
import { pseudonymise } from "./assistant.service.js";

describe("pseudonymise (RFC §12.6: field names never go to Gemini)", () => {
  const aliases = new Map([
    ["F1", { name: "Pivot 12" }],
    ["F2", { name: "Pivot 1" }],
    ["F3", { name: "Північна смуга" }],
  ]);
  it("replaces field names with aliases, longest first, any case", () => {
    expect(pseudonymise("Why is pivot 12 riskier than Pivot 1?", aliases)).toBe("Why is F1 riskier than F2?");
    expect(pseudonymise("Що з полем Північна смуга?", aliases)).toBe("Що з полем F3?");
  });
  it("leaves other numbers and words alone", () => {
    expect(pseudonymise("Pivot 123 is not ours; 12 mm fell.", aliases)).toBe(
      "Pivot 123 is not ours; 12 mm fell.",
    );
  });
});
