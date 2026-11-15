import { zip } from "./zip.js";
import { cleanLabel, ZONE_ORDER, type ExportFile, type ExportZone, type RateInput } from "./types.js";

type Ring = number[][];

/** Signed area, positive counter-clockwise (x = lon, y = lat). */
function area(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j]![0]! + ring[i]![0]!) * (ring[i]![1]! - ring[j]![1]!);
  return a / 2;
}

/** ESRI rule: outer rings clockwise, holes counter-clockwise. */
function esriRings(polygons: number[][][][]): Ring[] {
  const rings: Ring[] = [];
  for (const poly of polygons)
    poly.forEach((ring, i) => {
      const ccw = area(ring) > 0;
      const wantClockwise = i === 0;
      rings.push(wantClockwise === !ccw ? ring : [...ring].reverse());
    });
  return rings;
}

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

interface DbfField {
  name: string;
  type: "C" | "N";
  length: number;
  decimals: number;
}

/** Fits text into `length` bytes of UTF-8 without cutting a character. */
function fit(s: string, length: number): Buffer {
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch) > length) break;
    out += ch;
  }
  const b = Buffer.alloc(length, 0x20);
  b.write(out, "utf8");
  return b;
}

function dbf(fields: DbfField[], rows: Array<Array<string | number>>, now = new Date()): Buffer {
  const headerLen = 32 + fields.length * 32 + 1;
  const recLen = 1 + fields.reduce((s, f) => s + f.length, 0);
  const head = Buffer.alloc(headerLen);
  head[0] = 3;
  head[1] = now.getUTCFullYear() - 1900;
  head[2] = now.getUTCMonth() + 1;
  head[3] = now.getUTCDate();
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(headerLen, 8);
  head.writeUInt16LE(recLen, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    head.write(f.name, o, "ascii");
    head.write(f.type, o + 11, "ascii");
    head[o + 16] = f.length;
    head[o + 17] = f.decimals;
  });
  head[headerLen - 1] = 0x0d;
  const recs = rows.map((row) =>
    Buffer.concat([
      Buffer.from(" "),
      ...row.map((v, i) => {
        const f = fields[i]!;
        if (f.type === "C") return fit(String(v), f.length);
        const s = Number(v).toFixed(f.decimals);
        return Buffer.from(s.padStart(f.length, " ").slice(-f.length), "ascii");
      }),
    ]),
  );
  return Buffer.concat([head, ...recs, Buffer.from([0x1a])]);
}

/** .shp and .shx of polygon records, one record per zone. */
export function shp(records: Ring[][]): { shp: Buffer; shx: Buffer } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const bodies = records.map((rings) => {
    const pts = rings.flat();
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity;
    for (const [x, y] of pts) {
      bx0 = Math.min(bx0, x!);
      by0 = Math.min(by0, y!);
      bx1 = Math.max(bx1, x!);
      by1 = Math.max(by1, y!);
    }
    minX = Math.min(minX, bx0);
    minY = Math.min(minY, by0);
    maxX = Math.max(maxX, bx1);
    maxY = Math.max(maxY, by1);
    const b = Buffer.alloc(44 + rings.length * 4 + pts.length * 16);
    b.writeInt32LE(5, 0);
    b.writeDoubleLE(bx0, 4);
    b.writeDoubleLE(by0, 12);
    b.writeDoubleLE(bx1, 20);
    b.writeDoubleLE(by1, 28);
    b.writeInt32LE(rings.length, 36);
    b.writeInt32LE(pts.length, 40);
    let start = 0;
    rings.forEach((ring, i) => {
      b.writeInt32LE(start, 44 + i * 4);
      start += ring.length;
    });
    let o = 44 + rings.length * 4;
    for (const [x, y] of pts) {
      b.writeDoubleLE(x!, o);
      b.writeDoubleLE(y!, o + 8);
      o += 16;
    }
    return b;
  });
  const header = (lengthBytes: number) => {
    const h = Buffer.alloc(100);
    h.writeInt32BE(9994, 0);
    h.writeInt32BE(lengthBytes / 2, 24);
    h.writeInt32LE(1000, 28);
    h.writeInt32LE(5, 32);
    h.writeDoubleLE(minX, 36);
    h.writeDoubleLE(minY, 44);
    h.writeDoubleLE(maxX, 52);
    h.writeDoubleLE(maxY, 60);
    return h;
  };
  const shpParts: Buffer[] = [];
  const shxParts: Buffer[] = [];
  let offset = 100;
  bodies.forEach((body, i) => {
    const rec = Buffer.alloc(8);
    rec.writeInt32BE(i + 1, 0);
    rec.writeInt32BE(body.length / 2, 4);
    shpParts.push(rec, body);
    const idx = Buffer.alloc(8);
    idx.writeInt32BE(offset / 2, 0);
    idx.writeInt32BE(body.length / 2, 4);
    shxParts.push(idx);
    offset += 8 + body.length;
  });
  return {
    shp: Buffer.concat([header(offset), ...shpParts]),
    shx: Buffer.concat([header(100 + records.length * 8), ...shxParts]),
  };
}

/** Zipped shapefile (WGS 84): one polygon per zone with ZONE, RATE, UNIT, PRODUCT, AREA_HA and SHARE attributes. */
export function shapefileZip(zones: ExportZone[], input: RateInput, base: string): ExportFile {
  const present = ZONE_ORDER.map((z) => zones.find((x) => x.zone === z)).filter(
    (z): z is ExportZone => z !== undefined,
  );
  const { shp: shpBuf, shx } = shp(present.map((z) => esriRings(z.coordinates)));
  const product = cleanLabel(input.product, 50);
  const table = dbf(
    [
      { name: "ZONE", type: "C", length: 10, decimals: 0 },
      { name: "RATE", type: "N", length: 14, decimals: 3 },
      { name: "UNIT", type: "C", length: 10, decimals: 0 },
      { name: "PRODUCT", type: "C", length: 50, decimals: 0 },
      { name: "AREA_HA", type: "N", length: 12, decimals: 3 },
      { name: "SHARE", type: "N", length: 8, decimals: 4 },
    ],
    present.map((z) => [z.zone, input.rates[z.zone], input.unit, product, z.areaHa, z.share]),
  );
  return {
    filename: `${base}-shapefile.zip`,
    contentType: "application/zip",
    body: zip([
      { name: `${base}.shp`, data: shpBuf },
      { name: `${base}.shx`, data: shx },
      { name: `${base}.dbf`, data: table },
      { name: `${base}.prj`, data: Buffer.from(WGS84_PRJ, "ascii") },
      { name: `${base}.cpg`, data: Buffer.from("UTF-8", "ascii") },
    ]),
  };
}
