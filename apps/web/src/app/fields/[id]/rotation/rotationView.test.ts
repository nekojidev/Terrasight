import { YEAR_SET_IDS, type YearSetComparison, type YearSetId } from "@terrasight/shared";
import { describe, expect, it } from "vitest";
import {
  findYearSets,
  pestKey, planStatus, priceSourceKind, relaxedKey, reliabilityOf,
  visibleNotice,
} from "./rotationView";

describe("visibleNotice", () => {
  it("shows land first, then agronomy-only mode, then the estimate", () => {
    expect(visibleNotice({ landLimited: true, agro: true, estimatedCurrent: true })).toBe("land");
    expect(visibleNotice({ landLimited: false, agro: true, estimatedCurrent: true })).toBe("agro");
    expect(visibleNotice({ landLimited: false, agro: false, estimatedCurrent: true })).toBe("estimate");
    expect(visibleNotice({ landLimited: false, agro: false, estimatedCurrent: false })).toBeNull();
  });
});

describe("reliabilityOf", () => {
  const base = { agro: false, isCurrent: false, priceWins: 10 };
  it("is high when nothing weakens the pick", () => {
    expect(reliabilityOf({ ...base, currentBasis: "baseline", soilBasis: "ssurgo" })).toBe("high");
  });
  it("drops for fragile price wins and estimated inputs", () => {
    expect(reliabilityOf({ ...base, priceWins: 6 })).toBe("medium");
    expect(reliabilityOf({ ...base, priceWins: 3 })).toBe("low");
    expect(reliabilityOf({ ...base, currentBasis: "estimated", soilBasis: "default" })).toBe("low");
  });
  it("ignores prices without money or for the current rotation", () => {
    expect(reliabilityOf({ ...base, agro: true, priceWins: 0 })).toBe("high");
    expect(reliabilityOf({ ...base, isCurrent: true, priceWins: 0 })).toBe("high");
  });
});

describe("labels never fall back to raw ids", () => {
  it("maps known pests and sends unknown ids to the generic wording", () => {
    const has = (k: string) => k === "pest.western_corn_rootworm";
    expect(pestKey("western_corn_rootworm", has)).toBe("pest.western_corn_rootworm");
    expect(pestKey("something_new", has)).toBe("pest_unknown");
  });
  it("maps relaxed filters", () => {
    expect(relaxedKey("precipitation")).toBe("relaxed_precipitation");
    expect(relaxedKey("slope")).toBe("relaxed_slope");
    expect(relaxedKey("zzz")).toBe("relaxed_other");
  });
});

describe("priceSourceKind", () => {
  it("names the company first and names USDA only for a US library region", () => {
    expect(priceSourceKind({ priceLabel: "company", regionId: "ua-steppe" })).toBe("company");
    expect(priceSourceKind({ priceLabel: "mixed", regionId: "us-corn-belt" })).toBe("mixed");
    expect(priceSourceKind({ priceLabel: "library", regionId: "us-corn-belt" })).toBe("library_us");
    expect(priceSourceKind({ priceLabel: "library", regionId: "eu-central" })).toBe("library");
    expect(priceSourceKind({ priceLabel: null })).toBeNull();
  });
});

describe("planStatus", () => {
  const f = { hasLibrary: true, suitability: null, plan: null, recommendation: null };
  it("orders unsuitable land, no library, saved, proposed, none", () => {
    expect(planStatus({ ...f, suitability: { status: "unsuitable" } })).toBe("unsuitable");
    expect(planStatus({ ...f, suitability: { status: "unsuitable", override: {} } })).toBe("none");
    expect(planStatus({ ...f, hasLibrary: false })).toBe("no-library");
    expect(planStatus({ ...f, plan: {}, recommendation: {} })).toBe("saved");
    expect(planStatus({ ...f, recommendation: {} })).toBe("proposed");
    expect(planStatus(f)).toBe("none");
  });
});

describe("findYearSets", () => {
  const set = (id: YearSetId, ids: string[]): YearSetComparison["sets"][number] => ({
    id,
    years: { from: 1990, to: 2020, count: 20 },
    shift: null,
    best: ids[0]!,
    options: ids.map((o, i) => ({ id: o, rank: i + 1, margin: 1, drought: 1, score: 1 })),
  });
  const cmp = (sets: YearSetComparison["sets"]): YearSetComparison => ({
    mode: "money",
    currency: "USD",
    sets,
    bestChanges: true,
    names: {},
  });
  it("states nothing without the 'all' set or without a second set", () => {
    expect(findYearSets(cmp([set("last-15", ["a", "b"]), set("trend-2030", ["b", "a"])]), YEAR_SET_IDS, "a").kind).toBe(
      "none",
    );
    expect(findYearSets(cmp([set("all", ["a", "b"])]), YEAR_SET_IDS, "a").kind).toBe("none");
  });
  it("same winner but a different order is not called the same order", () => {
    const f = findYearSets(cmp([set("all", ["a", "b", "c"]), set("last-15", ["a", "c", "b"])]), YEAR_SET_IDS, "a");
    expect(f).toEqual({ kind: "same", sameOrder: false, complete: false });
  });
  it("lists only the sets whose best differs", () => {
    const f = findYearSets(
      cmp([set("all", ["a", "b"]), set("climate-1981-2000", ["a", "b"]), set("last-15", ["b", "a"])]),
      YEAR_SET_IDS,
      "x",
    );
    expect(f).toMatchObject({ kind: "changes", allBest: "a", changed: [{ set: "last-15", best: "b" }], currentNote: null });
  });
  it("current-rotation note only when it won in 1981–2000 and lost in the last 15 years", () => {
    const f = findYearSets(
      cmp([set("all", ["b", "a"]), set("climate-1981-2000", ["a", "b"]), set("last-15", ["b", "a"])]),
      YEAR_SET_IDS,
      "a",
    );
    expect(f).toMatchObject({ kind: "changes", currentNote: { rank: 2 } });
  });
});
