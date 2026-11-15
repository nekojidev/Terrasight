import { crc32, deflateSync } from "node:zlib";

/** Minimal RGBA PNG encoder (8-bit, no filtering) for small rasters such as the field's NDVI layer. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let r = 0; r < height; r++) {
    raw[r * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + r * width * 4, width * 4).copy(raw, r * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** NDVI colour ramp (bare soil to dense canopy); also drawn as the legend in the web app. */
export const NDVI_STOPS: Array<{ value: number; rgb: [number, number, number] }> = [
  { value: 0.0, rgb: [140, 81, 10] },
  { value: 0.2, rgb: [216, 179, 101] },
  { value: 0.4, rgb: [245, 230, 160] },
  { value: 0.6, rgb: [140, 200, 110] },
  { value: 0.8, rgb: [35, 139, 69] },
  { value: 0.95, rgb: [0, 68, 27] },
];

export function ndviColour(v: number): [number, number, number] {
  const s = NDVI_STOPS;
  if (v <= s[0]!.value) return s[0]!.rgb;
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i]!.value) {
      const a = s[i - 1]!;
      const b = s[i]!;
      const t = (v - a.value) / (b.value - a.value);
      return [0, 1, 2].map((k) => Math.round(a.rgb[k]! + (b.rgb[k]! - a.rgb[k]!) * t)) as [
        number,
        number,
        number,
      ];
    }
  }
  return s[s.length - 1]!.rgb;
}

/** RGBA image of an NDVI grid; cells that are not inside the field or have no value are transparent. */
export function ndviImage(values: ArrayLike<number>, inside: Uint8Array, w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = values[i]!;
    if (!inside[i] || !Number.isFinite(v)) continue;
    const [r, g, b] = ndviColour(v);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 235;
  }
  return rgba;
}
