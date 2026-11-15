import { describe, expect, it } from "vitest";
import { PutBody } from "../crop-prices/crop-prices.controller.js";
import { priceLabel, resolvePrices, type CompanyPrice, type LibraryPrice } from "./price-resolution.js";

const lib = (over: Partial<LibraryPrice> = {}): LibraryPrice => ({
  verified: true,
  price: 150,
  irrigated: { variableCost: 1000, yieldRef: 10 },
  dryland: { variableCost: 500, yieldRef: 5 },
  ...over,
});
const own = (over: Partial<CompanyPrice> = {}): CompanyPrice => ({
  crop: "corn",
  pricePerT: 9000,
  variableCostPerHa: 30000,
  yieldRefTHa: 8,
  irrigated: null,
  currency: "UAH",
  ...over,
});
const base = { crops: ["corn"], irrigated: false, currency: "USD", libraryCurrency: "USD" };

describe("price source precedence: company > verified library > none", () => {
  it("the company's price wins over a verified library price", () => {
    const r = resolvePrices({
      ...base,
      company: [own({ currency: "USD", pricePerT: 200, variableCostPerHa: 800, yieldRefTHa: 6 })],
      library: { corn: lib() },
    });
    expect(r.prices.corn).toEqual({ price: 200, variableCost: 800, yieldRef: 6 });
    expect(r.sources.corn).toBe("company");
  });

  it("a verified library entry is used when the company has none (dryland numbers for a rainfed field)", () => {
    const r = resolvePrices({ ...base, company: [], library: { corn: lib() } });
    expect(r.prices.corn).toEqual({ price: 150, variableCost: 500, yieldRef: 5 });
    expect(r.sources.corn).toBe("library");
  });

  it("an unverified library entry is never used: the crop stays missing", () => {
    const r = resolvePrices({ ...base, company: [], library: { corn: lib({ verified: false }) } });
    expect(r.prices.corn).toBeUndefined();
    expect(r.sources.corn).toBeUndefined();
    // its (unverified) yield is not used either
    expect(r.yieldRefs.corn).toBeUndefined();
  });

  it("library prices are not used in another currency (no FX conversion)", () => {
    const r = resolvePrices({ ...base, currency: "UAH", company: [], library: { corn: lib() } });
    expect(r.prices.corn).toBeUndefined();
  });

  it("company rows in another currency are ignored", () => {
    const r = resolvePrices({ ...base, company: [own({ currency: "UAH" })], library: {} });
    expect(r.prices.corn).toBeUndefined();
    // the yield is currency-free and still usable for the agronomy-only soil carbon
    expect(r.yieldRefs.corn).toBe(8);
  });

  it("an irrigation-specific row wins over an 'any' row and is skipped for the other kind of field", () => {
    const rows = [
      own({ currency: "USD", pricePerT: 1, irrigated: null }),
      own({ currency: "USD", pricePerT: 2, irrigated: true }),
    ];
    expect(resolvePrices({ ...base, irrigated: true, company: rows, library: {} }).prices.corn?.price).toBe(2);
    expect(resolvePrices({ ...base, irrigated: false, company: rows, library: {} }).prices.corn?.price).toBe(1);
    const only = [own({ currency: "USD", irrigated: true })];
    expect(resolvePrices({ ...base, irrigated: false, company: only, library: {} }).prices.corn).toBeUndefined();
  });

  it("a company price without a yield takes a verified library yield, else the user's yield is required", () => {
    const noYield = own({ currency: "USD", yieldRefTHa: null });
    const withLib = resolvePrices({ ...base, company: [noYield], library: { corn: lib() } });
    expect(withLib.prices.corn?.yieldRef).toBe(5);
    expect(withLib.sources.corn).toBe("company");
    const none = resolvePrices({ ...base, company: [noYield], library: { corn: lib({ verified: false }) } });
    expect(none.prices.corn).toBeUndefined();
    expect(none.needYield).toEqual(["corn"]);
  });

  it("page label: company, library or mixed", () => {
    const sources = { corn: "company", winter_wheat: "library" } as const;
    expect(priceLabel(sources, ["corn"])).toBe("company");
    expect(priceLabel(sources, ["winter_wheat", "fallow"])).toBe("library");
    expect(priceLabel(sources, ["corn", "winter_wheat"])).toBe("mixed");
    expect(priceLabel(sources, ["fallow"])).toBeNull();
  });
});

describe("crop price validation", () => {
  const row = { crop: "corn", pricePerT: 9000, variableCostPerHa: 30000 };
  it("accepts a row with an optional yield and irrigation kind", () => {
    expect(PutBody.safeParse({ rows: [{ ...row, yieldRefTHa: 7.5, irrigated: false }] }).success).toBe(true);
    expect(PutBody.safeParse({ rows: [row] }).success).toBe(true);
  });
  it("rejects non-positive prices, negative costs, absurd yields, duplicates and empty bodies", () => {
    expect(PutBody.safeParse({ rows: [{ ...row, pricePerT: 0 }] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [{ ...row, variableCostPerHa: -1 }] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [{ ...row, yieldRefTHa: 0 }] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [{ ...row, yieldRefTHa: 500 }] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [{ ...row, pricePerT: "9000" }] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [row, row] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [] }).success).toBe(false);
    expect(PutBody.safeParse({ rows: [], remove: ["corn"] }).success).toBe(true);
  });
});
