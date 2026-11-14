import { Pcg32 } from "./random.js";

/**
 * Price scenarios (RFC §7.4): 10 scenarios with a fixed seed, scenario 0 = base prices. Multipliers stay within ±20%.
 * Corn, sorghum and wheat share a grain-market factor plus their own noise; hay, cotton, oilseeds and pulses move
 * more independently. Applied after the weather step, so 10 price scenarios cost almost nothing.
 */
export const PRICE_SCENARIOS = 10;
export const PRICE_BAND = 0.2;

const GRAIN = new Set([
  "corn",
  "silage_corn",
  "sorghum",
  "forage_sorghum",
  "winter_wheat",
  "spring_wheat",
  "durum_wheat",
  "millet",
  "winter_barley",
  "spring_barley",
  "oat",
  "triticale",
  "winter_rye",
]);

const clamp = (x: number) => Math.max(1 - PRICE_BAND, Math.min(1 + PRICE_BAND, x));

/** multipliers[s][crop]; s = 0 is all ones. */
export function priceScenarios(
  crops: string[],
  rng: Pcg32,
  n = PRICE_SCENARIOS,
): Array<Record<string, number>> {
  const out: Array<Record<string, number>> = [Object.fromEntries(crops.map((c) => [c, 1]))];
  for (let s = 1; s < n; s++) {
    const grain = rng.normal() * 0.08;
    const row: Record<string, number> = {};
    for (const c of [...crops].sort()) {
      row[c] = GRAIN.has(c) ? clamp(1 + grain + rng.normal() * 0.04) : clamp(1 + rng.normal() * 0.09);
    }
    out.push(row);
  }
  return out;
}
