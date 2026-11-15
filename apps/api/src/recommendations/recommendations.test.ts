import { fileURLToPath } from "node:url";
import { loadLibrary } from "@terrasight/library";
import { describe, expect, it } from "vitest";
import { nextMorning, RecommendationsService } from "./recommendations.service.js";

describe("nextMorning (Snooze until 06:00 in the workspace time zone)", () => {
  it("is tomorrow 06:00 after 06:00, today 06:00 before it", () => {
    expect(nextMorning(new Date("2026-11-14T15:00:00Z"), "America/Chicago").toISOString()).toBe(
      "2026-11-15T12:00:00.000Z",
    );
    expect(nextMorning(new Date("2026-11-14T09:00:00Z"), "America/Chicago").toISOString()).toBe(
      "2026-11-14T12:00:00.000Z",
    );
    expect(nextMorning(new Date("2026-11-14T10:00:00Z"), "Europe/Kyiv").toISOString()).toBe(
      "2026-11-15T04:00:00.000Z",
    );
  });
  it("handles the DST change (US clocks go back on 1 November 2026)", () => {
    // 31 Oct 12:00 CDT → 1 Nov 06:00 CST = 12:00 UTC
    expect(nextMorning(new Date("2026-10-31T17:00:00Z"), "America/Chicago").toISOString()).toBe(
      "2026-11-01T12:00:00.000Z",
    );
  });
});

describe("RecommendationsService.text (AI text with the template as the fallback)", () => {
  const lib = loadLibrary(fileURLToPath(new URL("../../../../data/", import.meta.url)));
  const svc = Object.create(RecommendationsService.prototype, { lib: { value: lib } }) as RecommendationsService;
  const rec = {
    type: "pest" as const,
    subject: "western_corn_rootworm",
    season: 2026,
    level: "high" as const,
    planning: true,
    keyNumbers: [],
    drivers: [],
    textOverride: null,
  };
  const ai = {
    source: "ai",
    title: { en: "T", uk: "Т" },
    action: { en: "A", uk: "Д" },
    why: { en: "W", uk: "П" },
  };
  it("uses the assistant text when source is ai", () => {
    const t = svc.text({ ...rec, aiText: ai } as never);
    expect(t).toMatchObject({ title: ai.title, action: ai.action, why: ai.why, source: "ai" });
    expect(t.scout).not.toBeNull();
  });
  it("uses the template when the AI text failed a check or is absent", () => {
    for (const aiText of [null, { source: "template", hash: "x", reason: "number" }]) {
      const t = svc.text({ ...rec, aiText } as never);
      expect(t.source).toBe("template");
      expect(t.title.en).toMatch(/rootworm/i);
    }
  });
  it("a stored AI text with stray CJK letters falls back to the template (no migration)", () => {
    const bad = { ...ai, action: { en: "Discuss resistant hybrids with道の seed supplier", uk: "Д" } };
    const t = svc.text({ ...rec, aiText: bad } as never);
    expect(t.source).toBe("template");
    expect(JSON.stringify(t)).not.toContain("道");
  });
  it("an agronomist's edit wins over the assistant text", () => {
    const t = svc.text({ ...rec, aiText: ai, textOverride: { title: { en: "Mine", uk: "Моє" } } } as never);
    expect(t.title.en).toBe("Mine");
    expect(t.action.en).toBe("A");
  });
});
