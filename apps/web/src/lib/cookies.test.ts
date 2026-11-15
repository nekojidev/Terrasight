import { describe, expect, it } from "vitest";
import { cookieString } from "./api";
import { mapStyle } from "./map-style";
import { zoneLabel } from "./time-zone";

describe("client cookies", () => {
  it("adds Secure on https only", () => {
    expect(cookieString("a", "b c", 1, "https:")).toBe("a=b%20c; Path=/; Max-Age=86400; SameSite=Lax; Secure");
    expect(cookieString("a", "1", 1, "http:")).not.toContain("Secure");
  });
});

describe("mapStyle", () => {
  it("is one raster basemap with attribution", () => {
    const s = mapStyle();
    expect(s.layers).toHaveLength(1);
    expect(JSON.stringify(s.sources)).toContain("attribution");
  });
});

describe("zoneLabel", () => {
  it("localises the zone name and keeps the offset", () => {
    expect(zoneLabel("Europe/Kyiv", "en")).toMatch(/Kyiv — .*\(UTC\+\d\)/);
    expect(zoneLabel("Europe/Kyiv", "uk")).toMatch(/Kyiv — .*(часом|час).*\(UTC\+\d\)/);
  });
});
