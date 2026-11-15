/**
 * Crop parameters for the water balance and yield response (RFC §7.1).
 *
 * Sources: Allen et al. 1998, FAO Irrigation and Drainage Paper 56 — Table 11 (stage lengths), Table 12 (Kc ini /
 * mid / end), Table 22 (maximum root depth Zr, depletion fraction p); Doorenbos & Kassam 1979, FAO Paper 33 —
 * seasonal yield response factor Ky. Where FAO gives a range, the value is the mid-range used for the US Great Plains;
 * `adapted` marks values set for the region (e.g. winter crops whose season spans the dormancy) rather than read from
 * a table. Residue carbon: harvest index and root:shoot rules of thumb for ICBM inputs (Kätterer et al. 2011).
 */
export interface CropParams {
  id: string;
  /** Stage lengths, days: initial, development, mid-season, late season (FAO-56 Table 11). */
  stages: [number, number, number, number];
  /** Kc ini, mid, end (FAO-56 Table 12). */
  kc: [number, number, number];
  /** Maximum effective root depth, m (FAO-56 Table 22). */
  rootM: number;
  /** Soil water depletion fraction for no stress (FAO-56 Table 22). */
  p: number;
  /** Seasonal yield response factor (FAO-33). */
  ky: number;
  /** Carbon returned to soil per tonne of harvested product (t C / t), residues + roots (ICBM input). */
  residueC: number;
  /** Cover type for SCS-CN (USDA TR-55 Table 2-2b) and the RUSLE C factor. */
  cover: "row" | "small_grain" | "legume_hay" | "fallow";
  /** Crop cover-management factor C for the growing period (relative RUSLE). */
  cFactor: number;
  adapted?: boolean;
}

export const CROPS: Record<string, CropParams> = {
  corn: {
    id: "corn",
    stages: [30, 40, 50, 30],
    kc: [0.3, 1.2, 0.6],
    rootM: 1.2,
    p: 0.55,
    ky: 1.25,
    residueC: 0.45,
    cover: "row",
    cFactor: 0.25,
  },
  silage_corn: {
    id: "silage_corn",
    stages: [30, 40, 50, 10],
    kc: [0.3, 1.2, 0.9],
    rootM: 1.2,
    p: 0.55,
    ky: 1.25,
    residueC: 0.05,
    cover: "row",
    cFactor: 0.4,
  },
  sorghum: {
    id: "sorghum",
    stages: [20, 35, 40, 30],
    kc: [0.3, 1.05, 0.55],
    rootM: 1.5,
    p: 0.55,
    ky: 0.9,
    residueC: 0.5,
    cover: "row",
    cFactor: 0.25,
  },
  forage_sorghum: {
    id: "forage_sorghum",
    stages: [20, 35, 40, 15],
    kc: [0.3, 1.05, 0.9],
    rootM: 1.5,
    p: 0.55,
    ky: 0.9,
    residueC: 0.05,
    cover: "row",
    cFactor: 0.35,
  },
  winter_wheat: {
    id: "winter_wheat",
    stages: [150, 50, 45, 22],
    kc: [0.4, 1.15, 0.3],
    rootM: 1.5,
    p: 0.55,
    ky: 1.0,
    residueC: 0.55,
    cover: "small_grain",
    cFactor: 0.15,
    adapted: true,
  },
  spring_wheat: {
    id: "spring_wheat",
    stages: [20, 25, 60, 30],
    kc: [0.3, 1.15, 0.3],
    rootM: 1.2,
    p: 0.55,
    ky: 1.15,
    residueC: 0.55,
    cover: "small_grain",
    cFactor: 0.18,
  },
  soybean: {
    id: "soybean",
    stages: [20, 30, 60, 25],
    kc: [0.4, 1.15, 0.5],
    rootM: 1.0,
    p: 0.5,
    ky: 0.85,
    residueC: 0.35,
    cover: "row",
    cFactor: 0.35,
  },
  sunflower: {
    id: "sunflower",
    stages: [25, 35, 45, 25],
    kc: [0.35, 1.1, 0.35],
    rootM: 1.2,
    p: 0.45,
    ky: 0.95,
    residueC: 0.6,
    cover: "row",
    cFactor: 0.3,
  },
  alfalfa: {
    id: "alfalfa",
    stages: [10, 30, 150, 15],
    kc: [0.4, 0.95, 0.9],
    rootM: 1.5,
    p: 0.55,
    ky: 1.1,
    residueC: 0.15,
    cover: "legume_hay",
    cFactor: 0.02,
  },
  cotton: {
    id: "cotton",
    stages: [30, 50, 60, 55],
    kc: [0.35, 1.18, 0.6],
    rootM: 1.3,
    p: 0.65,
    ky: 0.85,
    residueC: 0.9,
    cover: "row",
    cFactor: 0.4,
  },
  millet: {
    id: "millet",
    stages: [15, 25, 40, 25],
    kc: [0.3, 1.0, 0.3],
    rootM: 1.5,
    p: 0.55,
    ky: 0.9,
    residueC: 0.6,
    cover: "small_grain",
    cFactor: 0.2,
    adapted: true,
  },
  winter_canola: {
    id: "winter_canola",
    stages: [150, 50, 45, 25],
    kc: [0.35, 1.1, 0.35],
    rootM: 1.2,
    p: 0.6,
    ky: 0.95,
    residueC: 0.7,
    cover: "small_grain",
    cFactor: 0.15,
    adapted: true,
  },
};

// Small-grain proxies for the Ukraine library (added 2026-11-15, UNREVIEWED). FAO-56 Table 12 gives barley, oats,
// spring wheat and winter wheat one Kc row (0.3 / 1.15 / 0.25-0.4), so these reuse the wheat parameters of the same
// sowing type (spring: spring_wheat; winter: winter_wheat), including the FAO-33 wheat Ky. Stage lengths, root depth
// and Ky differ a little by species; a team review should replace them with the species rows.
const proxy = (id: string, from: string): CropParams => ({ ...CROPS[from]!, id, adapted: true });
CROPS.spring_barley = proxy("spring_barley", "spring_wheat");
CROPS.oat = proxy("oat", "spring_wheat");
CROPS.winter_barley = proxy("winter_barley", "winter_wheat");
CROPS.winter_rye = proxy("winter_rye", "winter_wheat");

/** Bare soil: evaporation only (FAO-56 Ke for a wet surface drying out, mean ~0.3 between rains). */
export const FALLOW_KC = 0.3;
export const BARE_C = 0.45;

export function seasonLength(c: CropParams): number {
  return c.stages.reduce((a, b) => a + b, 0);
}

/** Daily Kc on day `d` after sowing (FAO-56 Fig. 25: flat initial, linear to mid, flat mid, linear to end). */
export function kcOnDay(c: CropParams, d: number): number {
  const [ini, dev, mid, late] = c.stages;
  const [kIni, kMid, kEnd] = c.kc;
  if (d < ini) return kIni;
  if (d < ini + dev) return kIni + ((d - ini) / dev) * (kMid - kIni);
  if (d < ini + dev + mid) return kMid;
  if (d < ini + dev + mid + late) return kMid + ((d - ini - dev - mid) / late) * (kEnd - kMid);
  return kEnd;
}

/** Root depth grows from 0.15 m at sowing to the maximum at the end of development (FAO-56 §8, Eq. 8-1 simplified). */
export function rootDepthOnDay(c: CropParams, d: number): number {
  const grow = c.stages[0] + c.stages[1];
  const min = 0.15;
  return d >= grow ? c.rootM : min + (d / grow) * (c.rootM - min);
}
