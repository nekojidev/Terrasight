/**
 * Stable zones from several seasons of peak-season NDVI (PD FR-ZN-1).
 *
 * Every season is normalised on its own: each pixel gets its percentile rank among the field's valid pixels
 * (so a wet and a dry year, or corn and wheat, become comparable). A pixel is then
 *   - "strong"   if its mean rank over the seasons is high and it is consistent from year to year,
 *   - "weak"     if its mean rank is low and it is consistent,
 *   - "variable" otherwise (the pixel changes its position from year to year, or sits in the middle).
 */
export const ZONE_STRONG = 1;
export const ZONE_VARIABLE = 2;
export const ZONE_WEAK = 3;
export type ZoneCode = 1 | 2 | 3;
export const ZONE_NAMES = { 1: "strong", 2: "variable", 3: "weak" } as const;
export type ZoneName = (typeof ZONE_NAMES)[ZoneCode];

export interface ZoneParams {
  /** Mean percentile at or above which a consistent pixel is "strong". */
  strongMean: number;
  /** Mean percentile at or below which a consistent pixel is "weak". */
  weakMean: number;
  /** Largest standard deviation of the percentile over the seasons for a pixel to count as consistent. */
  maxSd: number;
  /** A pixel needs valid values in at least this share of the seasons used. */
  minSeasonShare: number;
  /** A season counts only if at least this share of the field's pixels has a value. */
  minCoverage: number;
  /** Zone fragments smaller than this many cells are merged into their neighbours. */
  minCells: number;
}

export const DEFAULT_PARAMS: ZoneParams = {
  strongMean: 0.6,
  weakMean: 0.4,
  maxSd: 0.25,
  minSeasonShare: 0.6,
  minCoverage: 0.5,
  minCells: 12,
};

/** Percentile rank in (0, 1) of every inside cell with a finite value (ties share the mean rank); NaN elsewhere. */
export function percentileRanks(values: ArrayLike<number>, inside: Uint8Array): Float32Array {
  const out = new Float32Array(values.length).fill(NaN);
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) if (inside[i] && Number.isFinite(values[i]!)) idx.push(i);
  idx.sort((a, b) => values[a]! - values[b]!);
  const n = idx.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]!]! === values[idx[i]!]!) j++;
    const rank = (i + j) / 2 + 0.5;
    for (let k = i; k <= j; k++) out[idx[k]!] = rank / n;
    i = j + 1;
  }
  return out;
}

export interface PixelClasses {
  /** 0 = no decision (too few valid seasons), else ZoneCode. */
  cls: Uint8Array;
  mean: Float32Array;
  sd: Float32Array;
}

export function classifyPixels(
  ranks: Float32Array[],
  inside: Uint8Array,
  params: ZoneParams = DEFAULT_PARAMS,
): PixelClasses {
  const n = inside.length;
  const cls = new Uint8Array(n);
  const mean = new Float32Array(n).fill(NaN);
  const sd = new Float32Array(n).fill(NaN);
  const need = Math.max(2, Math.ceil(params.minSeasonShare * ranks.length));
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    let sum = 0;
    let sq = 0;
    let k = 0;
    for (const r of ranks) {
      const v = r[i]!;
      if (Number.isNaN(v)) continue;
      sum += v;
      sq += v * v;
      k += 1;
    }
    if (k < need) continue;
    const m = sum / k;
    const s = Math.sqrt(Math.max(0, sq / k - m * m));
    mean[i] = m;
    sd[i] = s;
    cls[i] =
      s <= params.maxSd && m >= params.strongMean
        ? ZONE_STRONG
        : s <= params.maxSd && m <= params.weakMean
          ? ZONE_WEAK
          : ZONE_VARIABLE;
  }
  return { cls, mean, sd };
}

/** 3x3 majority filter on inside cells; undecided cells (0) take the neighbours' majority. Ties keep the cell's own class. */
export function majorityFilter(
  cls: Uint8Array,
  inside: Uint8Array,
  w: number,
  h: number,
  passes = 2,
): Uint8Array {
  let cur = cls;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur);
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (!inside[i]) continue;
        const counts = [0, 0, 0, 0];
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
            counts[cur[rr * w + cc]!]! += 1;
          }
        counts[0] = -1; // undecided never wins
        let best = cur[i]!;
        let bestN = counts[best]!;
        for (let k = 1; k <= 3; k++)
          if (counts[k]! > bestN) {
            best = k;
            bestN = counts[k]!;
          }
        next[i] = best;
      }
    cur = next;
  }
  return cur;
}

/** Gives every undecided (0) cell the class of the nearest decided cell (4-neighbour breadth-first). */
export function fillNearest(cls: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(cls);
  const queue: number[] = [];
  for (let i = 0; i < out.length; i++) if (out[i]) queue.push(i);
  if (!queue.length) throw new Error("no classified cells");
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const r = Math.floor(i / w);
    const c = i % w;
    const push = (rr: number, cc: number) => {
      if (rr < 0 || cc < 0 || rr >= h || cc >= w) return;
      const j = rr * w + cc;
      if (out[j]) return;
      out[j] = out[i]!;
      queue.push(j);
    };
    push(r - 1, c);
    push(r + 1, c);
    push(r, c - 1);
    push(r, c + 1);
  }
  return out;
}

function neighbours(i: number, w: number, h: number): number[] {
  const r = Math.floor(i / w);
  const c = i % w;
  const out: number[] = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
}

/** Merges 4-connected fragments smaller than `minCells` into the neighbouring class they share most edges with. */
export function mergeSmall(cls: Uint8Array, w: number, h: number, minCells: number): Uint8Array {
  const out = new Uint8Array(cls);
  const seen = new Uint8Array(out.length);
  const small: number[][] = [];
  for (let s = 0; s < out.length; s++) {
    if (seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    for (let q = 0; q < comp.length; q++)
      for (const j of neighbours(comp[q]!, w, h))
        if (!seen[j] && out[j] === out[s]) {
          seen[j] = 1;
          comp.push(j);
        }
    if (comp.length < minCells) small.push(comp);
  }
  small.sort((a, b) => a.length - b.length);
  for (const comp of small) {
    const own = out[comp[0]!]!;
    const edges = [0, 0, 0, 0];
    for (const i of comp)
      for (const j of neighbours(i, w, h)) if (out[j] !== own) edges[out[j]!]! += 1;
    let best = 0;
    for (let k = 1; k <= 3; k++) if (edges[k]! > edges[best]!) best = k;
    if (best) for (const i of comp) out[i] = best;
  }
  return out;
}

export interface ZoneBuildInput {
  /** Peak-season NDVI per season (NaN = no valid value), one array per season, same grid. */
  seasons: Array<{ season: number; values: ArrayLike<number> }>;
  inside: Uint8Array;
  width: number;
  height: number;
  params?: ZoneParams;
}

export interface SeasonUse {
  season: number;
  /** Share of the field's pixels with a value. */
  coverage: number;
  used: boolean;
}

export interface ZoneRaster {
  /** Fully classified grid (every cell has 1..3) for polygonising; clip it to the field afterwards. */
  cls: Uint8Array;
  seasons: SeasonUse[];
  /** Per zone: pixel count inside the field and mean percentile. */
  stats: Record<ZoneName, { cells: number; meanPercentile: number | null }>;
}

export class NotEnoughSeasons extends Error {
  constructor(
    public readonly usable: number,
    public readonly required: number,
  ) {
    super(`only ${usable} seasons with usable imagery, ${required} needed`);
    this.name = "NotEnoughSeasons";
  }
}

export const MIN_SEASONS = 5;

/** The whole classification chain on already-read rasters. */
export function buildZoneRaster(input: ZoneBuildInput): ZoneRaster {
  const params = input.params ?? DEFAULT_PARAMS;
  const { inside, width: w, height: h } = input;
  let total = 0;
  for (let i = 0; i < inside.length; i++) total += inside[i]!;
  const uses: SeasonUse[] = input.seasons.map((s) => {
    let valid = 0;
    for (let i = 0; i < inside.length; i++) if (inside[i] && Number.isFinite(s.values[i]!)) valid += 1;
    const coverage = total ? valid / total : 0;
    return { season: s.season, coverage, used: coverage >= params.minCoverage };
  });
  const usable = uses.filter((u) => u.used).length;
  if (usable < MIN_SEASONS) throw new NotEnoughSeasons(usable, MIN_SEASONS);
  const ranks = input.seasons.filter((_, i) => uses[i]!.used).map((s) => percentileRanks(s.values, inside));
  const px = classifyPixels(ranks, inside, params);
  const smooth = majorityFilter(px.cls, inside, w, h, 2);
  const cls = mergeSmall(fillNearest(smooth, w, h), w, h, params.minCells);

  const sums = [0, 0, 0, 0];
  const cnt = [0, 0, 0, 0];
  const mcnt = [0, 0, 0, 0];
  for (let i = 0; i < cls.length; i++) {
    if (!inside[i]) continue;
    const k = cls[i]!;
    cnt[k]! += 1;
    if (!Number.isNaN(px.mean[i]!)) {
      sums[k]! += px.mean[i]!;
      mcnt[k]! += 1;
    }
  }
  const stat = (k: number) => ({
    cells: cnt[k]!,
    meanPercentile: mcnt[k]! ? Math.round((sums[k]! / mcnt[k]!) * 1000) / 1000 : null,
  });
  return { cls, seasons: uses, stats: { strong: stat(1), variable: stat(2), weak: stat(3) } };
}
