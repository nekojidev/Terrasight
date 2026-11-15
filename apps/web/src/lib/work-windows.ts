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
  return { key: `${prefix}_${l.factor}` as `${P}_${Factor}`, v, h: l.factor === "rain_soon" && val !== null ? n(val, 0) : "" };
}
