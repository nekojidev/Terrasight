import type { Units } from "@/lib/format";

/** The unit the export API understands. */
export type ApiUnit = "kg/ha" | "seeds/ha" | "l/ha";
export const API_UNITS: ApiUnit[] = ["kg/ha", "seeds/ha", "l/ha"];

const KG_HA_PER_LB_AC = 1.12085116;
const PER_HA_PER_PER_AC = 2.4710538147;
const L_HA_PER_GAL_AC = 9.35395;

/** What the user types in: lb/ac, seeds/ac, gal/ac for US fields; the API unit otherwise. */
export function unitSymbol(unit: ApiUnit, units: Units): string {
  if (units === "metric") return unit;
  return unit === "kg/ha" ? "lb/ac" : unit === "seeds/ha" ? "seeds/ac" : "gal/ac";
}

/** Factor that turns a typed rate (field units) into the API unit. */
export function rateFactor(unit: ApiUnit, units: Units): number {
  if (units === "metric") return 1;
  return unit === "kg/ha" ? KG_HA_PER_LB_AC : unit === "seeds/ha" ? PER_HA_PER_PER_AC : L_HA_PER_GAL_AC;
}

/** Typed text to a number in the API unit; NaN while empty or invalid. */
export function toApiRate(text: string, unit: ApiUnit, units: Units): number {
  if (text.trim() === "") return NaN;
  const v = Number(text.replace(",", "."));
  if (!Number.isFinite(v) || v < 0) return NaN;
  return Math.round(v * rateFactor(unit, units) * 1000) / 1000;
}
