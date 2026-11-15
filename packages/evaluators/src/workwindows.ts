// Work windows: when field operations are possible in the next days, from an hourly forecast and the thresholds in
// data/work-windows.json. Pure: no I/O. Conditions only, no product advice and no doses.

export type Operation = "spraying" | "sowing" | "traffic" | "fertiliser";
export const OPERATIONS: Operation[] = ["spraying", "sowing", "traffic", "fertiliser"];
export type WindowStatus = "good" | "marginal" | "no";

/** One forecast hour. `time` is local to the forecast cell, "YYYY-MM-DDTHH:00". Past hours are included. */
export interface HourlyPoint {
  time: string;
  tempC: number | null;
  rhPct: number | null;
  precipMm: number | null;
  windMs: number | null;
  gustMs: number | null;
  soilTemp6cmC: number | null;
}

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
  | "daylight"
  | "no_threshold";

/** The factor that limits an hour or day; `value` is in SI units (m/s, °C, mm, h). */
export interface Limiting {
  factor: Factor;
  value: number | null;
}

export interface Threshold {
  value: number;
  unit: string;
  verified: boolean;
  quantified?: boolean;
}

export interface WorkWindowsConfig {
  version: number;
  minWindowHours: Record<Operation, number>;
  dayHours: { from: number; to: number };
  spraying: Record<string, Threshold>;
  sowing: { crops: Record<string, Threshold> } & Record<string, unknown>;
  traffic: Record<string, Threshold>;
  fertiliser: Record<string, Threshold>;
}

export interface HourResult {
  status: WindowStatus;
  limiting: Limiting | null;
}

export interface WindowSpan {
  /** First and last hour of the run, "HH:00" local. */
  from: string;
  to: string;
  status: WindowStatus;
  limiting: Limiting | null;
}

export interface DayWindows {
  date: string;
  status: WindowStatus;
  /** Why the day is not good (most common limiting factor in daytime), null for a good day. */
  limiting: Limiting | null;
  windows: WindowSpan[];
}

export interface OperationWindows {
  operation: Operation;
  /** false = no threshold for this crop (sowing) */
  applicable: boolean;
  crop?: string | null;
  days: DayWindows[];
}

const RANK: Record<WindowStatus, number> = { good: 0, marginal: 1, no: 2 };

/** Wet-bulb temperature (Stull 2011, valid for RH 5–99 %, −20…50 °C). */
export function wetBulbC(tC: number, rh: number): number {
  return (
    tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/** Delta-T = dry-bulb − wet-bulb (°C): the droplet evaporation index spray guidance uses. */
export function deltaT(tC: number, rh: number): number {
  return Math.max(0, tC - wetBulbC(tC, Math.min(99, Math.max(5, rh))));
}

type Ev = { status: WindowStatus; limiting: Limiting | null };
const OK: Ev = { status: "good", limiting: null };
const worst = (...evs: Ev[]): Ev => evs.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a), OK);
const v = (c: Record<string, Threshold>, k: string): number => {
  const t = c[k];
  if (!t) throw new Error(`work-windows: missing threshold ${k}`);
  return t.value;
};

const sum = (xs: HourlyPoint[], from: number, to: number): number => {
  let s = 0;
  for (let i = Math.max(0, from); i < Math.min(xs.length, to); i++) s += xs[i]!.precipMm ?? 0;
  return s;
};

/** Hour-by-hour evaluation of one operation. `crop` only matters for sowing. */
export function evaluateHours(
  op: Operation,
  hours: HourlyPoint[],
  cfg: WorkWindowsConfig,
  crop: string | null = null,
): HourResult[] | null {
  const isRain = (i: number, mm: number) => (hours[i]?.precipMm ?? 0) >= mm;
  return hours.map((h, i): Ev => {
    if (op === "spraying") {
      const c = cfg.spraying;
      const evs: Ev[] = [];
      if (h.windMs !== null) {
        if (h.windMs > v(c, "windMaxMs")) evs.push({ status: "no", limiting: { factor: "wind", value: h.windMs } });
        else if (h.windMs < v(c, "windMinMs"))
          evs.push({ status: "marginal", limiting: { factor: "wind_low", value: h.windMs } });
      }
      if (h.gustMs !== null && (h.windMs ?? 0) <= v(c, "windMaxMs") && h.gustMs > v(c, "gustMaxMs"))
        evs.push({ status: "marginal", limiting: { factor: "gust", value: h.gustMs } });
      // Hours until the next rainy hour (this hour = 0); data ends at the horizon, so no rain is assumed beyond it.
      const rainMm = v(c, "rainHourMm");
      let wait: number | null = null;
      for (let j = i; j < hours.length; j++)
        if (isRain(j, rainMm)) {
          wait = j - i;
          break;
        }
      if (wait !== null) {
        if (wait === 0) evs.push({ status: "no", limiting: { factor: "rain_now", value: h.precipMm } });
        else if (wait <= v(c, "rainFreeNoHours")) evs.push({ status: "no", limiting: { factor: "rain_soon", value: wait } });
        else if (wait < v(c, "rainFreeGoodHours"))
          evs.push({ status: "marginal", limiting: { factor: "rain_soon", value: wait } });
      }
      if (h.tempC !== null && h.tempC > v(c, "temperatureMaxC"))
        evs.push({ status: "marginal", limiting: { factor: "temperature", value: h.tempC } });
      if (h.tempC !== null && h.rhPct !== null) {
        const dt = deltaT(h.tempC, h.rhPct);
        if (dt > v(c, "deltaTNoAbove")) evs.push({ status: "no", limiting: { factor: "delta_t", value: round1(dt) } });
        else if (dt > v(c, "deltaTGoodMax") || dt < v(c, "deltaTGoodMin"))
          evs.push({ status: "marginal", limiting: { factor: "delta_t", value: round1(dt) } });
      }
      return worst(...evs);
    }
    if (op === "sowing") {
      const min = crop ? cfg.sowing.crops[crop]?.value : undefined;
      const evs: Ev[] = [];
      if (min !== undefined) {
        const win = hours.slice(Math.max(0, i - 12), i + 13).map((x) => x.soilTemp6cmC).filter((x): x is number => x !== null);
        if (win.length) {
          const mean = win.reduce((a, b) => a + b, 0) / win.length;
          if (mean < min) evs.push({ status: "no", limiting: { factor: "soil_temp", value: round1(mean) } });
        }
      }
      const c = cfg.sowing as unknown as Record<string, Threshold>;
      const past = sum(hours, i - 24, i + 1);
      if (past >= v(c, "rainPast24hNoMm")) evs.push({ status: "no", limiting: { factor: "rain_past", value: round1(past) } });
      else if (past >= v(c, "rainPast24hMarginalMm"))
        evs.push({ status: "marginal", limiting: { factor: "rain_past", value: round1(past) } });
      const next = sum(hours, i + 1, i + 7);
      if (next >= v(c, "rainNext6hNoMm")) evs.push({ status: "marginal", limiting: { factor: "rain_next", value: round1(next) } });
      return worst(...evs);
    }
    if (op === "traffic") {
      const c = cfg.traffic;
      const evs: Ev[] = [];
      const past = sum(hours, i - 48, i + 1);
      if (past >= v(c, "rainPast48hNoMm")) evs.push({ status: "no", limiting: { factor: "rain_past", value: round1(past) } });
      else if (past >= v(c, "rainPast48hMarginalMm"))
        evs.push({ status: "marginal", limiting: { factor: "rain_past", value: round1(past) } });
      const next = sum(hours, i + 1, i + 7);
      if (next >= v(c, "rainNext6hNoMm")) evs.push({ status: "no", limiting: { factor: "rain_next", value: round1(next) } });
      else if (next >= v(c, "rainNext6hMarginalMm"))
        evs.push({ status: "marginal", limiting: { factor: "rain_next", value: round1(next) } });
      return worst(...evs);
    }
    const c = cfg.fertiliser;
    const evs: Ev[] = [];
    if ((h.precipMm ?? 0) >= v(c, "rainHourNoMm")) evs.push({ status: "no", limiting: { factor: "rain_now", value: h.precipMm } });
    const next = sum(hours, i, i + 24);
    if (next >= v(c, "rainNext24hNoMm")) evs.push({ status: "no", limiting: { factor: "rain_next", value: round1(next) } });
    else if (next >= v(c, "rainNext24hMarginalMm"))
      evs.push({ status: "marginal", limiting: { factor: "rain_next", value: round1(next) } });
    return worst(...evs);
  });
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Windows for one operation over the days from `now` (local "YYYY-MM-DDTHH:00" of the cell) for `days` days.
 * Only daylight hours count; the hours already past today do not. A day is good when it has a run of at least
 * `minWindowHours` good hours, marginal when good-or-marginal hours reach that length, else no.
 */
export function operationWindows(
  op: Operation,
  hours: HourlyPoint[],
  cfg: WorkWindowsConfig,
  now: string,
  days = 7,
  crop: string | null = null,
): OperationWindows {
  if (op === "sowing" && (!crop || !cfg.sowing.crops[crop]))
    return { operation: op, applicable: false, crop, days: [] };
  const results = evaluateHours(op, hours, cfg, crop) ?? [];
  const { from, to } = cfg.dayHours;
  const need = cfg.minWindowHours[op];
  const dates = [...new Set(hours.map((h) => h.time.slice(0, 10)))].filter((d) => d >= now.slice(0, 10)).slice(0, days);
  const out: DayWindows[] = dates.map((date) => {
    const day: Array<{ hour: number; r: HourResult }> = [];
    hours.forEach((h, i) => {
      if (!h.time.startsWith(date) || h.time < now) return;
      const hour = Number(h.time.slice(11, 13));
      if (hour >= from && hour < to) day.push({ hour, r: results[i]! });
    });
    if (!day.length) return { date, status: "no", limiting: { factor: "daylight", value: null }, windows: [] };
    // Runs of consecutive hours with the same status.
    const runs: Array<{ start: number; end: number; status: WindowStatus; items: typeof day }> = [];
    for (const d of day) {
      const last = runs[runs.length - 1];
      if (last && last.end === d.hour - 1 && last.status === d.r.status) {
        last.end = d.hour;
        last.items.push(d);
      } else runs.push({ start: d.hour, end: d.hour, status: d.r.status, items: [d] });
    }
    const windows: WindowSpan[] = runs.map((r) => ({
      from: hh(r.start),
      to: hh(r.end + 1),
      status: r.status,
      limiting: r.status === "good" ? null : (worstLimiting(r.items.map((x) => x.r)) ?? null),
    }));
    const longest = (ok: (s: WindowStatus) => boolean) => {
      let best = 0;
      let cur = 0;
      let prev = -2;
      for (const d of day) {
        cur = ok(d.r.status) && d.hour === prev + 1 ? cur + 1 : ok(d.r.status) ? 1 : 0;
        prev = d.hour;
        best = Math.max(best, cur);
      }
      return best;
    };
    const status: WindowStatus =
      longest((s) => s === "good") >= need ? "good" : longest((s) => s !== "no") >= need ? "marginal" : "no";
    const bad = day.map((d) => d.r).filter((r) => r.status !== "good");
    return {
      date,
      status,
      limiting: status === "good" ? null : (modeLimiting(bad) ?? null),
      windows,
    };
  });
  return { operation: op, applicable: true, crop, days: out };
}

/** The most severe, then first, limiting factor of a run of hours. */
function worstLimiting(rs: HourResult[]): Limiting | null {
  let best: HourResult | null = null;
  for (const r of rs) if (r.limiting && (!best || RANK[r.status] > RANK[best.status])) best = r;
  return best?.limiting ?? null;
}

/** The factor that blocks most hours (ties: more severe); its value is the extreme one. */
function modeLimiting(rs: HourResult[]): Limiting | null {
  const by = new Map<Factor, { n: number; sev: number; l: Limiting }>();
  for (const r of rs) {
    if (!r.limiting) continue;
    const e = by.get(r.limiting.factor);
    const sev = RANK[r.status];
    if (!e) by.set(r.limiting.factor, { n: 1, sev, l: r.limiting });
    else {
      e.n += 1;
      e.sev = Math.max(e.sev, sev);
      if (r.limiting.value !== null && (e.l.value === null || r.limiting.value > e.l.value)) e.l = r.limiting;
    }
  }
  const sorted = [...by.values()].sort((a, b) => b.n - a.n || b.sev - a.sev);
  return sorted[0]?.l ?? null;
}

export interface WorkWindowsResult {
  operations: OperationWindows[];
}

/** All operations for one field. */
export function computeWorkWindows(
  hours: HourlyPoint[],
  cfg: WorkWindowsConfig,
  now: string,
  opts: { days?: number; sowingCrop?: string | null } = {},
): WorkWindowsResult {
  return {
    operations: OPERATIONS.map((op) => operationWindows(op, hours, cfg, now, opts.days ?? 7, opts.sowingCrop ?? null)),
  };
}

/** True when any threshold in the file is still unverified (the UI labels the windows). */
export function unverifiedThresholds(cfg: WorkWindowsConfig): boolean {
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== "object") return false;
    const o = n as Record<string, unknown>;
    if (typeof o.verified === "boolean") return !o.verified;
    return Object.values(o).some(walk);
  };
  return walk(cfg);
}
