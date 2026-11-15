import { describe, expect, it } from "vitest";
import {
  buildItems,
  fieldIdFromPath,
  filterFields,
  filterPages,
  moveIndex,
  pushRecent,
  readRecent,
  type PaletteField,
  type PalettePage,
} from "./palette";

const fields: PaletteField[] = [
  { id: "1", name: "Pivot 12", place: "Finney County, Kansas", crop: "Corn" },
  { id: "2", name: "Північна смуга", place: "Запорізька область", crop: "Пшениця" },
  { id: "3", name: "South strip", place: "Garden City, Pivot", crop: "Sorghum" },
];
const pages: PalettePage[] = [
  { id: "analyze", label: "Analyze fields", action: "analyze" },
  { id: "decisions", label: "Owner decisions", href: "/decisions" },
  { id: "rotation", label: "Rotations", href: "/rotation", keywords: "rotation plan" },
];

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("palette filtering", () => {
  it("matches name, county/oblast and crop, ignoring case; name prefix first", () => {
    expect(filterFields(fields, "pivot").map((f) => f.id)).toEqual(["1", "3"]);
    expect(filterFields(fields, "kansas").map((f) => f.id)).toEqual(["1"]);
    expect(filterFields(fields, "запорізька").map((f) => f.id)).toEqual(["2"]);
    expect(filterFields(fields, "sorghum").map((f) => f.id)).toEqual(["3"]);
    expect(filterFields(fields, "північна ПІВНІЧНА".split(" ")[0]!).map((f) => f.id)).toEqual(["2"]);
  });
  it("needs every word, and nothing for an empty query", () => {
    expect(filterFields(fields, "pivot corn").map((f) => f.id)).toEqual(["1"]);
    expect(filterFields(fields, "pivot wheat")).toEqual([]);
    expect(filterFields(fields, "  ")).toEqual([]);
  });
  it("finds pages by label or keyword", () => {
    expect(filterPages(pages, "decis").map((p) => p.id)).toEqual(["decisions"]);
    expect(filterPages(pages, "plan").map((p) => p.id)).toEqual(["rotation"]);
    expect(filterPages(pages, "")).toEqual([]);
  });
});

describe("buildItems", () => {
  const base = { fields, pages, recent: [fields[2]!], suggestions: ["Summarise the day"] };
  it("typing: the ask row is first, then fields, then pages", () => {
    const items = buildItems({ ...base, query: " pivot " });
    expect(items[0]).toMatchObject({ kind: "ask", text: "pivot" });
    expect(items.map((i) => i.group)).toEqual(["ask", "fields", "fields"]);
    const withPage = buildItems({ ...base, query: "rotation" });
    expect(withPage.map((i) => i.group)).toEqual(["ask", "pages"]);
  });
  it("always offers the ask row, even with no matches", () => {
    expect(buildItems({ ...base, query: "zzz" })).toEqual([{ group: "ask", id: "ask", kind: "ask", text: "zzz" }]);
  });
  it("empty, ask mode: questions first, then recent fields, then pages", () => {
    const groups = buildItems({ ...base, query: "" }).map((i) => i.group);
    expect(groups[0]).toBe("suggest");
    expect(groups).toContain("recent");
    expect(groups.at(-1)).toBe("pages");
  });
  it("empty, go mode: fields and pages first, questions last", () => {
    const groups = buildItems({ ...base, query: "", mode: "go" }).map((i) => i.group);
    expect(groups[0]).toBe("recent");
    expect(groups.at(-1)).toBe("suggest");
  });
  it("empty without recents lists the fields", () => {
    expect(buildItems({ ...base, recent: [], query: "" }).some((i) => i.group === "fields")).toBe(true);
  });
  it("go mode typing: ask row last", () => {
    const items = buildItems({ ...base, query: "pivot", mode: "go" });
    expect(items.at(-1)).toMatchObject({ group: "ask" });
    expect(items[0]!.group).toBe("fields");
  });
});

describe("keyboard", () => {
  it("moves down and up with wrap-around, and survives an empty list", () => {
    expect(moveIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(moveIndex(2, 3, "ArrowDown")).toBe(0);
    expect(moveIndex(0, 3, "ArrowUp")).toBe(2);
    expect(moveIndex(1, 3, "ArrowUp")).toBe(0);
    expect(moveIndex(1, 3, "End")).toBe(2);
    expect(moveIndex(1, 3, "a")).toBe(1);
    expect(moveIndex(0, 0, "ArrowDown")).toBe(-1);
  });
});

describe("recent fields", () => {
  it("keeps the latest five without duplicates", () => {
    const s = memory();
    for (const id of ["a", "b", "c", "d", "e", "f", "c"]) pushRecent("w", id, s);
    expect(readRecent("w", s)).toEqual(["c", "f", "e", "d", "b"]);
    expect(readRecent("other", s)).toEqual([]);
  });
  it("tolerates junk and missing storage", () => {
    const s = { getItem: () => "{oops", setItem: () => undefined };
    expect(readRecent("w", s)).toEqual([]);
    expect(pushRecent("w", "x", null)).toEqual(["x"]);
  });
});

describe("fieldIdFromPath", () => {
  it("reads a field id from a field page only", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(fieldIdFromPath(`/fields/${id}`)).toBe(id);
    expect(fieldIdFromPath(`/fields/${id}/plan`)).toBe(id);
    expect(fieldIdFromPath("/fields/new")).toBeNull();
    expect(fieldIdFromPath("/assistant")).toBeNull();
  });
});
