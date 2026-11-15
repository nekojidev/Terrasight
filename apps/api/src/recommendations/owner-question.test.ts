import type { Library } from "@terrasight/library";
import { describe, expect, it } from "vitest";
import { ownerQuestionText } from "./text.js";

const lib = {
  rotations: { rotations: [{ id: "ltd", name: { en: "Limited irrigation", uk: "Обмежений полив" } }] },
} as unknown as Library;
const title = { en: "Late blight: high risk", uk: "Фітофтороз: високий ризик" };
const drivers = (best: string) => [{ driver: "best_option", value: best, fired: true }];

describe("ownerQuestionText", () => {
  it("asks about the rotation change from the item's own fields, over 5 seasons", () => {
    const q = ownerQuestionText(
      { type: "rotation", subject: "x", season: 2026, drivers: drivers("ltd") },
      lib,
      "Pivot 14",
      "Marko",
      title,
    );
    expect(q.en).toBe("Marko asks: may we change the rotation on Pivot 14 to “Limited irrigation” for 2026–2030?");
    expect(q.uk).toContain("Marko питає");
    expect(q.uk).toContain("«Обмежений полив»");
    expect(q.uk).toContain("2026–2030");
  });

  it("asks to keep the current rotation", () => {
    const q = ownerQuestionText(
      { type: "rotation", subject: "x", season: 2026, drivers: drivers("current") },
      lib,
      "Pivot 14",
      "Marko",
      title,
    );
    expect(q.en).toBe("Marko asks: may we keep the current rotation on Pivot 14 for 2026–2030?");
  });

  it("falls back to a generic question with the title and a neutral asker", () => {
    const q = ownerQuestionText({ type: "pest", subject: "p", season: 2026, drivers: [] }, null, "North", "", title);
    expect(q.en).toBe("Your agronomist asks for your decision on North: Late blight: high risk");
    expect(q.uk).toContain("Ваш агроном");
  });
});
