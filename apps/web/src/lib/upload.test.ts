import { describe, expect, it } from "vitest";
import { parseCoordinates, readAddFieldMode, ringFromFile, selfIntersects, UploadError, writeAddFieldMode } from "./upload";

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

describe("upload errors", () => {
  const code = async (f: File) => ringFromFile(f).catch((e: unknown) => (e as UploadError).code);
  it("names the problem", async () => {
    expect(await code(new File(["x"], "a.txt"))).toBe("format");
    expect(await code(new File(["{nope"], "a.geojson"))).toBe("unreadable");
    expect(await code(new File([JSON.stringify({ type: "Point", coordinates: [0, 0] })], "a.geojson"))).toBe(
      "no-polygon",
    );
    const bow = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
      [0, 0],
    ];
    expect(
      await code(new File([JSON.stringify({ type: "Polygon", coordinates: [bow] })], "a.geojson")),
    ).toBe("self-intersect");
  });
  it("reports progress up to 1", async () => {
    const seen: number[] = [];
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    await ringFromFile(new File([JSON.stringify({ type: "Polygon", coordinates: [sq] })], "a.geojson"), (f) =>
      seen.push(f),
    );
    expect(seen.at(-1)).toBe(1);
  });
});

describe("selfIntersects", () => {
  it("is false for a square and true for a bow-tie", () => {
    expect(selfIntersects([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
    expect(selfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
  });
});

describe("add-field mode memory", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("opens on 'Upload a file' by default", () => {
    expect(readAddFieldMode(store())).toBe("file");
    expect(readAddFieldMode(null)).toBe("file");
  });
  it("remembers the last mode within the visit", () => {
    const s = store();
    writeAddFieldMode("draw", s);
    expect(readAddFieldMode(s)).toBe("draw");
    writeAddFieldMode("file", s);
    expect(readAddFieldMode(s)).toBe("file");
  });
  it("survives blocked storage", () => {
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeAddFieldMode("draw", bad)).not.toThrow();
    expect(readAddFieldMode(bad)).toBe("file");
  });
});
