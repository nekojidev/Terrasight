/**
 * USDA CDL class codes → library crop ids (data/rotations.json). `null` = not a crop in the library
 * (grassland, developed, water…). Double-crop classes map to { main, second } (RFC §7.8).
 * Codes from the NASS CDL metadata (cdl_codes); only classes relevant to the library are listed by name.
 */
export type CdlCrop = string | { main: string; second: string } | null;

const CROPS: Record<number, CdlCrop> = {
  1: "corn",
  2: "cotton",
  3: "rice",
  4: "sorghum",
  5: "soybean",
  6: "sunflower",
  10: "peanut",
  12: "corn", // sweet corn
  13: "corn", // pop or ornamental corn
  21: "spring_barley", // CDL doesn't split winter / spring barley
  22: "durum_wheat",
  23: "spring_wheat",
  24: "winter_wheat",
  25: "winter_wheat", // other small grains
  26: { main: "winter_wheat", second: "soybean" },
  27: "winter_rye",
  28: "oat",
  29: "millet",
  31: "winter_canola", // canola; spring canola in the northern plains is resolved by region below
  32: "flax",
  36: "alfalfa",
  41: "sugar_beet",
  43: "potato",
  51: "chickpea",
  52: "lentil",
  53: "pea",
  58: "clover_grass", // clover / wildflowers
  59: "clover_grass", // sod / grass seed
  61: "fallow", // fallow / idle cropland
  205: "triticale",
  225: { main: "winter_wheat", second: "corn" },
  228: { main: "triticale", second: "corn" },
  226: { main: "oat", second: "corn" },
  236: { main: "winter_wheat", second: "sorghum" },
  237: { main: "spring_barley", second: "corn" },
  238: { main: "winter_wheat", second: "cotton" },
  240: { main: "soybean", second: "oat" },
  241: { main: "corn", second: "soybean" },
  254: { main: "spring_barley", second: "soybean" },
};

const NAMES: Record<number, string> = {
  37: "Other hay / non-alfalfa",
  111: "Open water",
  121: "Developed / open space",
  122: "Developed / low intensity",
  123: "Developed / medium intensity",
  124: "Developed / high intensity",
  131: "Barren",
  141: "Deciduous forest",
  142: "Evergreen forest",
  143: "Mixed forest",
  152: "Shrubland",
  176: "Grassland / pasture",
  190: "Woody wetlands",
  195: "Herbaceous wetlands",
};

export function cdlCrop(code: number, regionId?: string | null): CdlCrop {
  const crop = CROPS[code] ?? null;
  if (crop === "winter_canola" && (regionId === "us-northern-plains" || regionId === "ca-prairies"))
    return "spring_canola";
  return crop;
}

export function cdlName(code: number): string {
  const crop = CROPS[code];
  if (typeof crop === "string") return crop;
  if (crop) return `${crop.main} + ${crop.second}`;
  return NAMES[code] ?? `CDL class ${code}`;
}
