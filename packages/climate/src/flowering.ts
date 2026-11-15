import type { FloweringWindow } from "@terrasight/shared";
import type { Hemisphere } from "./season.js";

/** A checkable source of one value (data/crop-flowering.json). */
export interface FloweringSource {
  title: string;
  publisher: string;
  url: string;
  /** ISO date the page was opened. */
  accessed: string;
}

export interface CropFloweringEntry {
  threshold: { valueC: number; sources: FloweringSource[]; note?: string };
  window: {
    /** Flowering window as days after emergence (the published rules of thumb count from emergence). */
    afterEmergence?: { from: number; to: number; sources: FloweringSource[]; note?: string };
    /** Calendar window per region id of data/crop-calendar.json. */
    regions?: Record<string, { from: string; to: string; sources: FloweringSource[]; note?: string }>;
  };
  verified: boolean;
}

export interface CropFloweringTable {
  version: number;
  fallback: {
    thresholdC: number;
    north: { from: string; to: string };
    south: { from: string; to: string };
  };
  crops: Record<string, CropFloweringEntry>;
}

const YEAR_MS = Date.UTC(2001, 0, 1);

/** Add `days` to an MM-DD (non-leap calendar, wraps over the year end). */
export function addDays(mmdd: string, days: number): string {
  const day = (Date.UTC(2001, Number(mmdd.slice(0, 2)) - 1, Number(mmdd.slice(3, 5))) - YEAR_MS) / 86_400_000;
  const wrapped = (((day + days) % 365) + 365) % 365;
  return new Date(YEAR_MS + wrapped * 86_400_000).toISOString().slice(5, 10);
}

export interface FloweringQuery {
  crop: string | null;
  regionId: string | null;
  /** Recorded or estimated emergence date as MM-DD, used with the "days after emergence" rule. */
  emergenceMmdd: string | null;
  hemisphere: Hemisphere;
}

/**
 * Flowering window and heat threshold of a crop: region calendar window → "N to M days after emergence" from the sowing
 * date → the labelled fallback of T5 (35 °C, June–August; December–February in the south, `fallback: true`).
 * `verified` stays false until the owner reviews the entry.
 */
export function resolveFlowering(table: CropFloweringTable, q: FloweringQuery): FloweringWindow {
  const fb = (): FloweringWindow => ({
    thresholdC: table.fallback.thresholdC,
    from: table.fallback[q.hemisphere].from,
    to: table.fallback[q.hemisphere].to,
    verified: false,
    fallback: true,
    source: null,
  });
  const entry = q.crop ? table.crops[q.crop] : undefined;
  if (!entry) return fb();
  const reg = q.regionId ? entry.window.regions?.[q.regionId] : undefined;
  const base = { thresholdC: entry.threshold.valueC, verified: entry.verified, fallback: false };
  const src = (list: FloweringSource[]) => {
    const s = list[0];
    return s ? { title: s.title, publisher: s.publisher, url: s.url } : null;
  };
  if (reg) return { ...base, from: reg.from, to: reg.to, source: src(reg.sources) };
  const after = entry.window.afterEmergence;
  if (after && q.emergenceMmdd)
    return {
      ...base,
      from: addDays(q.emergenceMmdd, after.from),
      to: addDays(q.emergenceMmdd, after.to),
      source: src(after.sources),
    };
  return fb();
}
