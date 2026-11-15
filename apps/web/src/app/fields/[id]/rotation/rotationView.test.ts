import { describe, expect, it } from "vitest";
import { pestKey, planStatus, priceSourceKind, relaxedKey, reliabilityOf, visibleNotice } from "./rotationView";

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
