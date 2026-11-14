import { describe, expect, it } from "vitest";
import { parseCoordinates, ringFromFile } from "./upload";

describe("parseCoordinates", () => {
  it("reads 'lat, lon' into [lon, lat]", () => {
    expect(parseCoordinates("37.97, -100.87")).toEqual([-100.87, 37.97]);
    expect(parseCoordinates(" 50.45 30.52 ")).toEqual([30.52, 50.45]);
  });
  it("rejects place names and out-of-range values", () => {
    expect(parseCoordinates("Garden City")).toBeNull();
    expect(parseCoordinates("120, 30")).toBeNull();
  });
});

describe("ringFromFile", () => {
  const square = [
    [-101, 38],
    [-100.99, 38],
    [-100.99, 38.01],
    [-101, 38.01],
    [-101, 38],
  ];
  const file = (name: string, body: string) => new File([body], name);

  it("takes the first polygon of a GeoJSON FeatureCollection and drops the closing vertex", async () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [square] } },
      ],
    };
    expect(await ringFromFile(file("f.geojson", JSON.stringify(fc)))).toEqual(square.slice(0, -1));
  });
  it("reads a MultiPolygon", async () => {
    expect(
      await ringFromFile(file("f.json", JSON.stringify({ type: "MultiPolygon", coordinates: [[square]] }))),
    ).toHaveLength(4);
  });
  it("fails when there is no polygon", async () => {
    await expect(
      ringFromFile(file("f.geojson", JSON.stringify({ type: "Point", coordinates: [0, 0] }))),
    ).rejects.toThrow();
  });
});
