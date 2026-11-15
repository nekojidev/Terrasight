export type Operation = "spraying" | "sowing" | "traffic" | "fertiliser";
export type WindowStatus = "good" | "marginal" | "no" | "unknown";
export type Factor =
  | "wind"
  | "wind_low"
  | "gust"
  | "rain_now"
  | "rain_soon"
  | "temperature"
  | "delta_t"
  | "soil_temp"
  | "rain_past"
  | "rain_next"
  | "rain_day"
  | "daylight";

export interface Limiting {
  factor: Factor;
  value: number | null;
}
export interface Condition extends Limiting {
  verified: boolean;
}
export interface WindowSpan {
  from: string;
  to: string;
  status: WindowStatus;
  limiting: Limiting | null;
}
export interface DayWindows {
  date: string;
  status: WindowStatus;
  limiting: Limiting | null;
  windows: WindowSpan[];
  conditions?: Condition[];
}
export interface OperationWindows {
  operation: Operation;
  applicable: boolean;
  crop?: string | null;
  days: DayWindows[];
}
export interface FieldWindows {
  fieldId: string;
  name: string;
  country?: string | null;
  sowingCrop: string | null;
  available: boolean;
  forecast: { origin: "live" | "cache" | "stale"; ageHours: number; attribution: string } | null;
  now: string | null;
  operations: OperationWindows[];
}
export interface WorkWindowsView {
  days: number;
  thresholdsUnverified: boolean;
  thresholdsVersion: number;
  cropNames: Record<string, { en: string; uk: string }>;
  fields: FieldWindows[];
}

export const OPERATIONS: Operation[] = ["spraying", "sowing", "traffic", "fertiliser"];

/** The formatters a factor value needs (a slice of `useFormat()`), so the function stays testable. */
export interface FactorFormatters {
  wind: (ms: number) => string;
  temp: (c: number) => string;
  rain: (mm: number) => string;
  number: (n: number, opts?: { maximumFractionDigits?: number }) => string;
}

/** Message key and values for one factor, with the value in the company's units (via `useFormat`). */
export function factorText<P extends string>(
  l: Limiting,
  fmt: FactorFormatters,
  prefix: P,
): { key: `${P}_${Factor}`; v: string; h: string } {
  const val = l.value;
  let v = "";
  if (val !== null) {
    switch (l.factor) {
      case "wind":
      case "wind_low":
      case "gust":
        v = fmt.wind(val);
        break;
      case "temperature":
      case "soil_temp":
        v = fmt.temp(val);
        break;
      case "rain_now":
      case "rain_past":
      case "rain_next":
      case "rain_day":
        v = fmt.rain(val);
        break;
      default:
        v = fmt.number(val, { maximumFractionDigits: 1 });
    }
  }
  return {
    key: `${prefix}_${l.factor}` as `${P}_${Factor}`,
    v,
    h: l.factor === "rain_soon" && val !== null ? fmt.number(val, { maximumFractionDigits: 0 }) : "",
  };
}

export const workWindowsKey = (workspaceId: string, fieldId?: string) =>
  ["work-windows", workspaceId, fieldId ?? "all"] as const;

/** The API speaks SI; imperial workspaces see mph, °F and inches. */
export function formatLimit(
  l: Limiting,
  units: "metric" | "imperial",
): { key: `wwLim_${Factor}`; v: string; h: string } {
  return formatCondition(l, units, "wwLim");
}

export function formatCondition<P extends string>(
  l: Limiting,
  units: "metric" | "imperial",
  prefix: P,
): { key: `${P}_${Factor}`; v: string; h: string } {
  const imp = units === "imperial";
  const n = (x: number, d = 1) => String(Math.round(x * 10 ** d) / 10 ** d);
  const val = l.value;
  let v = "";
  if (val !== null) {
    switch (l.factor) {
      case "wind":
      case "wind_low":
      case "gust":
        v = imp ? `${n(val * 2.236936)} mph` : `${n(val)} m/s`;
        break;
      case "temperature":
      case "soil_temp":
        v = imp ? `${n((val * 9) / 5 + 32, 0)} °F` : `${n(val)} °C`;
        break;
      case "delta_t":
        v = `${n(val)}`;
        break;
      case "rain_now":
      case "rain_past":
      case "rain_next":
      case "rain_day":
        v = imp ? `${n(val / 25.4, 2)} in` : `${n(val)} mm`;
        break;
      default:
        v = n(val);
    }
  }
  return {
    key: `${prefix}_${l.factor}` as `${P}_${Factor}`,
    v,
    h: l.factor === "rain_soon" && val !== null ? n(val, 0) : "",
  };
}

export interface BestDay {
  date: string;
  /** Index of the day in the week (0 = today). */
  index: number;
  /** Fields with a "good" verdict that day. */
  good: number;
  /** Fields that have a verdict for the operation (no forecast or only "no verdict yet" is not counted). */
  total: number;
}

/** True when the field shows a real verdict for the operation on at least one day. */
export function hasVerdict(f: FieldWindows, op: Operation): boolean {
  const o = f.operations.find((x) => x.operation === op);
  return f.available && !!o?.applicable && o.days.some((d) => d.status !== "unknown");
}

/**
 * The day of the week with the most fields in "good" condition for one operation (ties: the earlier day).
 * Computed from the matrix data only; null when no field has a verdict or no day is good anywhere.
 */
export function bestDay(fields: FieldWindows[], op: Operation): BestDay | null {
  const rated = fields.filter((f) => hasVerdict(f, op));
  if (rated.length === 0) return null;
  const n = Math.max(...rated.map((f) => f.operations.find((x) => x.operation === op)!.days.length));
  let best: BestDay | null = null;
  for (let i = 0; i < n; i++) {
    let good = 0;
    let date = "";
    for (const f of rated) {
      const d = f.operations.find((x) => x.operation === op)!.days[i];
      if (!d) continue;
      date = date || d.date;
      if (d.status === "good") good++;
    }
    if (good > 0 && date && (!best || good > best.good)) best = { date, index: i, good, total: rated.length };
  }
  return best;
}

/** Units follow the field's country (US = imperial); a field without a country uses the company default. */
export function unitsForCountry(
  country: string | null | undefined,
  fallback: "metric" | "imperial",
): "metric" | "imperial" {
  if (!country) return fallback;
  return country.toUpperCase() === "US" ? "imperial" : "metric";
}
