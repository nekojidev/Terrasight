import { describe, expect, it } from "vitest";
import { distinctTitles, evidenceLink, suggestionKeys } from "./assistant-context";
import { answerLang } from "./assistant-text";

const REC = "123e4567-e89b-42d3-a456-426614174000";
const aliases = { F1: { id: "field-1", name: "North quarter" } };

describe("evidenceLink", () => {
  it("prefers the recommendation, then the rotation page, then the field", () => {
    expect(evidenceLink([{ tool: "get_weather", args: { field: "F1" } }, { tool: "explain_recommendation", args: { id: REC } }], aliases)).toEqual({
      kind: "recommendation",
      href: `/recommendations/${REC}`,
    });
    expect(evidenceLink([{ tool: "get_year_set_ranking", args: { field: "F1" } }], aliases)?.href).toBe("/fields/field-1/rotation");
    expect(evidenceLink([{ tool: "get_climate_shift", args: { field: "F1" } }], aliases)?.href).toBe("/fields/field-1");
  });
  it("gives nothing for tools without a screen or unknown aliases", () => {
    expect(evidenceLink([{ tool: "compare", args: {} }], aliases)).toBeNull();
    expect(evidenceLink([{ tool: "get_weather", args: { field: "F9" } }], aliases)).toBeNull();
  });
});

describe("suggestionKeys", () => {
  it("differs by context", () => {
    expect(suggestionKeys({})).toEqual(["all1", "all2", "all3"]);
    expect(suggestionKeys({ fieldId: "x" })).toEqual(["field1", "field2", "field3"]);
    expect(suggestionKeys({ fieldId: "x", recommendationId: "y" })).toEqual(["rec1", "rec2", "rec3"]);
  });
});

describe("distinctTitles", () => {
  it("tells repeated titles apart by field, else by time", () => {
    const items = [
      { id: "a", title: "Why is this the main thing", contextFieldId: "f1", createdAt: "2026-11-01" },
      { id: "b", title: "Why is this the main thing", contextFieldId: null, createdAt: "2026-11-02" },
      { id: "c", title: null, contextFieldId: null, createdAt: "2026-11-03" },
    ];
    const t = distinctTitles(items, (id) => (id === "f1" ? "North" : undefined), (iso) => iso, "New chat");
    expect(t.get("a")).toBe("Why is this the main thing · North");
    expect(t.get("b")).toBe("Why is this the main thing · 2026-11-02");
    expect(t.get("c")).toBe("New chat");
  });
});

describe("answerLang", () => {
  it("detects the language of the letters", () => {
    expect(answerLang("Corn on North quarter in 2027")).toBe("en");
    expect(answerLang("Кукурудза на полі Північ у 2027 році")).toBe("uk");
    expect(answerLang("OK")).toBeNull();
  });
});
