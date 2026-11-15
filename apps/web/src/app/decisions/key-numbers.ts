import type { Decision } from "@terrasight/shared";

export interface KeyNumberView {
  id: string;
  value: string;
  label: string;
}

/** Units the UI may print next to a number; descriptive English units from the API ("host seasons in a row") are not printed. */
const SYMBOL_UNITS = new Set(["%", "°C", "°C·d", "mm", "days", "ha", "cm", "t/ha", "kg/ha", "l/ha", "$/ha", "pH", "g/kg"]);

/** The printable part of a unit: "mm depletion" → "mm", "seasons" → null. */
export function unitSymbol(unit: string | undefined): string | null {
  if (!unit) return null;
  const first = unit.split(" ")[0] ?? "";
  return SYMBOL_UNITS.has(unit) ? unit : SYMBOL_UNITS.has(first) ? first : null;
}

/**
 * Key numbers of a decision as value + label pairs, at most `max`. A number whose `kn_<id>` label has no translation is
 * hidden (a raw key must never reach the screen). A label that starts with the unit has it cut off, since the value
 * already carries it ("°C mean this autumn" with 12 °C → "12 °C" · "mean this autumn").
 */
export function keyNumberViews(
  d: Pick<Decision, "keyNumbers">,
  fmt: { number: (n: number) => string; date: (iso: string) => string },
  label: (id: string) => string | null,
  max = 3,
): KeyNumberView[] {
  const out: KeyNumberView[] = [];
  for (const k of d.keyNumbers) {
    if (out.length >= max) break;
    const name = label(k.id);
    if (!name) continue;
    const symbol = unitSymbol(k.unit);
    let value: string;
    if (typeof k.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.value)) value = fmt.date(k.value);
    else if (typeof k.value === "number") value = symbol ? `${fmt.number(k.value)} ${symbol}` : fmt.number(k.value);
    else value = symbol ? `${k.value} ${symbol}` : String(k.value);
    const text = symbol && name.startsWith(`${symbol} `) ? name.slice(symbol.length + 1) : name;
    out.push({ id: k.id, value, label: text });
  }
  return out;
}
