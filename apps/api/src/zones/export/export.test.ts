import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { geojsonFile } from "./geojson.js";
import { isoxmlZip, taskDataXml, UnsupportedUnit } from "./isoxml.js";
import { shapefileZip } from "./shapefile.js";
import type { ExportField, ExportZone, RateInput } from "./types.js";
import { zip } from "./zip.js";

const sq = (x: number, y: number, s: number, hole = false) => {
  const outer = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  const h = [[x + s / 4, y + s / 4], [x + s / 4, y + s / 2], [x + s / 2, y + s / 2], [x + s / 2, y + s / 4], [x + s / 4, y + s / 4]];
  return hole ? [outer, h] : [outer];
};
const ZONES: ExportZone[] = [
  { zone: "strong", areaHa: 40, share: 0.5, coordinates: [sq(-100.9, 37.9, 0.01, true)] },
  { zone: "variable", areaHa: 8, share: 0.1, coordinates: [sq(-100.89, 37.9, 0.01)] },
  { zone: "weak", areaHa: 32, share: 0.4, coordinates: [sq(-100.88, 37.9, 0.01), sq(-100.87, 37.9, 0.005)] },
];
const FIELD: ExportField = { name: "Pivot 12 & <north>", areaHa: 80, coordinates: [sq(-100.9, 37.9, 0.04)] };
const INPUT: RateInput = { rates: { strong: 12.5, variable: 10, weak: 7 }, unit: "kg/ha", product: "Label \"A\"" };

/** Reads stored entries back from a zip. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    const start = off + 30 + buf.readUInt16LE(off + 26);
    out.set(name, buf.subarray(start, start + size));
    p += 46 + nameLen;
  }
  return out;
}

describe("zip", () => {
  it("round-trips stored entries", () => {
    const files = unzip(zip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "d/b.txt", data: Buffer.from("x") }]));
    expect(files.get("a.txt")!.toString()).toBe("hello");
    expect([...files.keys()]).toEqual(["a.txt", "d/b.txt"]);
    void inflateRawSync;
  });
});

describe("shapefile export", () => {
  const file = shapefileZip(ZONES, INPUT, "pivot-rate-zones");
  const files = unzip(file.body);

  it("contains shp, shx, dbf, prj and cpg", () => {
    expect([...files.keys()].sort()).toEqual(
      ["pivot-rate-zones.cpg", "pivot-rate-zones.dbf", "pivot-rate-zones.prj", "pivot-rate-zones.shp", "pivot-rate-zones.shx"],
    );
    expect(files.get("pivot-rate-zones.prj")!.toString()).toContain("GCS_WGS_1984");
  });

  it("writes 3 polygon records with a consistent header and index", () => {
    const shp = files.get("pivot-rate-zones.shp")!;
    const shx = files.get("pivot-rate-zones.shx")!;
    expect(shp.readInt32BE(0)).toBe(9994);
    expect(shp.readInt32BE(24) * 2).toBe(shp.length);
    expect(shp.readInt32LE(32)).toBe(5);
    expect(shx.readInt32BE(24) * 2).toBe(shx.length);
    expect((shx.length - 100) / 8).toBe(3);
    // walk the records
    let p = 100;
    const parts: number[] = [];
    for (let i = 0; i < 3; i++) {
      expect(shp.readInt32BE(p)).toBe(i + 1);
      expect(shx.readInt32BE(100 + i * 8) * 2).toBe(p);
      const len = shp.readInt32BE(p + 4) * 2;
      expect(shp.readInt32LE(p + 8)).toBe(5);
      parts.push(shp.readInt32LE(p + 8 + 36));
      p += 8 + len;
    }
    expect(p).toBe(shp.length);
    expect(parts).toEqual([2, 1, 2]); // outer + hole, one square, two squares
    expect(shp.readDoubleLE(36)).toBeCloseTo(-100.9); // bbox xmin
  });

  it("orients outer rings clockwise and holes counter-clockwise", () => {
    const shp = files.get("pivot-rate-zones.shp")!;
    const nParts = shp.readInt32LE(108 + 36);
    const nPts = shp.readInt32LE(108 + 40);
    expect(nParts).toBe(2);
    const starts = [shp.readInt32LE(108 + 44), shp.readInt32LE(108 + 48)];
    const base = 108 + 44 + nParts * 4;
    const pt = (i: number) => [shp.readDoubleLE(base + i * 16), shp.readDoubleLE(base + i * 16 + 8)];
    const area = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b - 1; i++) s += pt(i)![0]! * pt(i + 1)![1]! - pt(i + 1)![0]! * pt(i)![1]!;
      return s / 2;
    };
    expect(area(starts[0]!, starts[1]!)).toBeLessThan(0); // outer: clockwise
    expect(area(starts[1]!, nPts)).toBeGreaterThan(0); // hole: counter-clockwise
  });

  it("stores the agronomist's RATE per zone in the dbf", () => {
    const d = files.get("pivot-rate-zones.dbf")!;
    expect(d.readUInt32LE(4)).toBe(3);
    const headerLen = d.readUInt16LE(8);
    const recLen = d.readUInt16LE(10);
    const names = [];
    for (let o = 32; d[o] !== 0x0d; o += 32) names.push(d.subarray(o, o + 11).toString().replace(/\0+$/, ""));
    expect(names).toEqual(["ZONE", "RATE", "UNIT", "PRODUCT", "AREA_HA", "SHARE"]);
    const rec = (i: number) => d.subarray(headerLen + i * recLen, headerLen + (i + 1) * recLen).toString();
    expect(rec(0).slice(1, 11).trim()).toBe("strong");
    expect(Number(rec(0).slice(11, 25))).toBe(12.5);
    expect(Number(rec(2).slice(11, 25))).toBe(7);
    expect(rec(1)).toContain("kg/ha");
    expect(rec(1)).toContain('Label "A"');
  });
});

describe("geojson export", () => {
  it("has one feature per zone with RATE, UNIT and areas", () => {
    const f = geojsonFile(ZONES, INPUT, "x", "base");
    const j = JSON.parse(f.body.toString()) as { features: Array<{ properties: Record<string, unknown>; geometry: { type: string } }> };
    expect(j.features.map((x) => x.properties.ZONE)).toEqual(["strong", "variable", "weak"]);
    expect(j.features.map((x) => x.properties.RATE)).toEqual([12.5, 10, 7]);
    expect(j.features[0]!.properties.UNIT).toBe("kg/ha");
    expect(j.features[0]!.geometry.type).toBe("MultiPolygon");
    expect(f.filename).toBe("base.geojson");
  });
});

describe("isoxml export", () => {
  const xml = taskDataXml(FIELD, ZONES, INPUT);

  it("has the ISOXML skeleton: root, partfield, task, 3 treatment zones with setpoints", () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<ISO11783_TaskData VersionMajor="4" VersionMinor="2"/);
    expect(xml).toContain('<PFD A="PFD1"');
    expect(xml).toContain('<TSK A="TSK1"');
    expect(xml.match(/<TZN /g)).toHaveLength(3);
    // kg/ha -> mg/m2 x 100, DDI 0006
    expect(xml).toContain('<PDV A="0006" B="1250" C="PDT1"/>');
    expect(xml).toContain('<PDV A="0006" B="700" C="PDT1"/>');
    expect(xml).toContain('<PDT A="PDT1" B="Label &quot;A&quot;"/>');
    expect(xml).toContain("Pivot 12 &amp; &lt;north&gt;");
    expect(xml).toContain('<PLN A="2"'); // treatment-zone polygons
    expect(xml).toContain('<LSG A="2">'); // the hole of the strong zone
  });

  it("is well formed (balanced tags, closed rings dropped to open point lists)", () => {
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9_]+)([^>]*?)(\/?)>/g)) {
      if (m[2] === "xml") continue;
      if (m[4]) continue;
      if (m[1]) expect(stack.pop()).toBe(m[2]);
      else stack.push(m[2]!);
    }
    expect(stack).toEqual([]);
    const lsg = xml.match(/<LSG A="1">(.*?)<\/LSG>/)![1]!;
    expect(lsg.match(/<PNT /g)).toHaveLength(4);
  });

  it("converts l/ha and refuses seeds/ha", () => {
    expect(taskDataXml(FIELD, ZONES, { ...INPUT, unit: "l/ha", product: undefined })).toContain('<PDV A="0001" B="1250"/>');
    expect(() => taskDataXml(FIELD, ZONES, { ...INPUT, unit: "seeds/ha" })).toThrow(UnsupportedUnit);
  });

  it("ships TASKDATA/TASKDATA.XML in a zip", () => {
    const files = unzip(isoxmlZip(FIELD, ZONES, INPUT, "b").body);
    expect([...files.keys()]).toEqual(["TASKDATA/TASKDATA.XML"]);
  });
});
