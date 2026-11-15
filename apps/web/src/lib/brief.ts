/** Pure helpers of the home page (brief): plain-language headline, dates inside text and key numbers. */

/** Replaces ISO dates (2026-11-21) in text with a readable date ("21 November"). */
export function humanizeDates(text: string, format: (iso: string) => string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : format(iso);
  });
}

export type HeadlineKind = "decisions" | "urgent" | "none";

/**
 * The one sentence on top of the home page. The Owner leads with the decisions waiting for them; the Agronomist
 * (or an Owner with nothing to answer) with how many things cannot wait today.
 */
export function briefHeadline(input: {
  isOwner: boolean;
  decisions: number;
  urgent: number;
}): { kind: HeadlineKind; n: number } {
  if (input.isOwner && input.decisions > 0) return { kind: "decisions", n: input.decisions };
  if (input.urgent > 0) return { kind: "urgent", n: input.urgent };
  return { kind: "none", n: 0 };
}

/** How a key number's value is shown. Only ids listed here are shown: an unknown id never reaches the screen. */
type KeyKind = "count" | "percent" | "temp" | "mm" | "date" | "money";
const KEY_KIND: Record<string, KeyKind> = {
  hostSeasonsInRow: "count",
  hostSeasonsInPlan: "count",
  lastCropInRow: "count",
  autumnPercentile: "percent",
  autumnMeanC: "temp",
  frostMinC: "temp",
  daysSinceEmergence: "count",
  daysUntilFrost: "count",
  daysToStress: "count",
  greenDaysBeforeSowing: "count",
  daysBeforeBpmp: "count",
  degreeDays: "count",
  degreeDaysIn7Days: "count",
  sowingDate: "date",
  frostDate: "date",
  depletionMm: "mm",
  rawMm: "mm",
  tawMm: "mm",
  marginVsCurrent: "money",
};

/** The formatters `formatKeyNumber` needs (a subset of `useFormat()`). */
export interface KeyNumberFormat {
  date: (iso: string) => string;
  number: (n: number) => string;
  percent: (fraction: number) => string;
  temp: (celsius: number) => string;
  rain: (mm: number) => string;
  money: (amount: number, currency: "USD" | "UAH") => string;
}

export interface KeyNumberInput {
  id: string;
  value: number | string;
  unit?: string;
}

/**
 * Display text of one key number, or null when the id is unknown or the value does not fit its kind
 * (for example "—"). The label (with the unit in words) is looked up by the caller as `kn_<id>`.
 */
export function formatKeyNumber(k: KeyNumberInput, fmt: KeyNumberFormat): string | null {
  const kind = KEY_KIND[k.id];
  if (!kind) return null;
  if (kind === "date") {
    return typeof k.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.value) ? fmt.date(k.value) : null;
  }
  if (typeof k.value === "string" && k.value.trim() === "") return null;
  const n = typeof k.value === "number" ? k.value : Number(k.value);
  if (!Number.isFinite(n)) return null;
  switch (kind) {
    case "percent":
      return fmt.percent(n / 100);
    case "temp":
      return fmt.temp(n);
    case "mm":
      return fmt.rain(n);
    case "money": {
      const code = (k.unit ?? "").split("/")[0]?.replace("$", "USD");
      return code === "USD" || code === "UAH" ? fmt.money(n, code) : null;
    }
    default:
      return fmt.number(n);
  }
}
