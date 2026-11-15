import { describe, expect, it } from "vitest";
import { fetchGpmSeries, gpmCell, parseGpmValue, parseGranules, rateToMm } from "./gpm.js";

describe("GPM IMERG monthly", () => {
  it("finds the 0.1° cell (precipitation is [time][lon][lat])", () => {
    const c = gpmCell(38.1, -101.05);
    expect(c.i).toBe(789);
    expect(c.lon).toBe(-101.05);
    expect(c.j).toBeGreaterThanOrEqual(1280);
    expect(gpmCell(-89.99, -179.99)).toMatchObject({ i: 0, j: 0 });
  });

  it("converts the mm/hr monthly mean rate to mm per month", () => {
    expect(rateToMm(0.1, "2021-01")).toBe(74.4); // 0.1 × 24 × 31
    expect(rateToMm(0.1, "2021-02")).toBe(67.2);
    expect(rateToMm(0.1, "2020-02")).toBe(69.6);
  });

  it("parses granule ids from a CMR response (shape recorded from the CMR)", () => {
    const m = parseGranules({
      feed: {
        entry: [
          { title: "GPM_3IMERGM.07:3B-MO.MS.MRG.3IMERG.20010101-S000000-E235959.01.V07B.HDF5" },
          { title: "GPM_3IMERGM.07:3B-MO.MS.MRG.3IMERG.20250901-S000000-E235959.09.V07B.HDF5" },
          { title: "something else" },
        ],
      },
    });
    expect([...m.keys()]).toEqual(["2001-01", "2025-09"]);
  });

  // The DAP4 CSV body below follows the Hyrax documentation's shape; it is NOT a recording (the live read was refused,
  // see the S-10.11 report), so only the parsing rules are tested, not the numbers.
  it("parses a DAP4 CSV answer and the fill value", () => {
    const body = "Dataset: 3B-MO.MS.MRG.3IMERG.20200101-S000000-E235959.01.V07B.HDF5\nGrid/precipitation[0][789][1280]\n0.0213\n";
    expect(parseGpmValue(body)).toBe(0.0213);
    expect(parseGpmValue("Dataset: x\nGrid/precipitation[0][1][2]\n-9999.9\n")).toBeNull();
  });

  it("reports an OPeNDAP error body instead of a value", () => {
    expect(() => parseGpmValue('Dataset: x\nError { code = 403; message = "EULA"; }')).toThrow(/OPeNDAP returned an error/);
  });

  it("says what to do when GES DISC refuses the token", async () => {
    const f = (async (u: string | URL) => {
      const url = String(u);
      if (url.includes("cmr.earthdata"))
        return new Response(
          JSON.stringify({
            feed: { entry: [{ title: "GPM_3IMERGM.07:3B-MO.MS.MRG.3IMERG.20010101-S000000-E235959.01.V07B.HDF5" }] },
          }),
          { status: 200 },
        );
      return new Response("denied", { status: 403 });
    }) as typeof fetch;
    await expect(
      fetchGpmSeries(38.1, -101.05, "token", { signal: new AbortController().signal, fetch: f }),
    ).rejects.toThrow(/accept the NASA GESDISC DATA ARCHIVE/);
  });

  it("is not configured without a token", async () => {
    await expect(
      fetchGpmSeries(38.1, -101.05, undefined, { signal: new AbortController().signal, fetch }),
    ).rejects.toThrow(/not configured/);
  });
});
