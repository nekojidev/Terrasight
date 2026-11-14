import type { ConfidenceLevel, Level } from "./types.js";

export type Urgency = "urgent" | "this_week" | "all_good";

export interface UrgencyItem {
  /** ISO date (yyyy-mm-dd) in the workspace's calendar, or null. */
  deadline: string | null;
  irreversible: boolean;
  planning: boolean;
  openScoutingTask: boolean;
}

/** Planning items join This week this many days before their deadline (RFC §10.5). */
export const PLANNING_LEAD_DAYS = 14;

/** Today's calendar date in a time zone. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole calendar days from today (in the workspace time zone) to the deadline; negative when overdue. DST-safe. */
export function daysUntil(deadline: string, now: Date, timeZone: string): number {
  const today = localDay(now, timeZone);
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * Urgency (RFC §10.5, Tech Design §10.2): Urgent = ≤ 7 days and irreversible, or ≤ 2 days; This week = any other
 * ≤ 7 days and every open scouting task; All good = the rest. Planning items stay in All good until 14 days before
 * their deadline, then join This week (and follow the normal rules inside 7 days).
 */
export function classifyUrgency(item: UrgencyItem, now: Date, timeZone: string): Urgency {
  const days = item.deadline ? daysUntil(item.deadline, now, timeZone) : null;
  if (days !== null && (days <= 2 || (days <= 7 && item.irreversible))) return "urgent";
  if (days !== null && days <= 7) return "this_week";
  if (item.openScoutingTask) return "this_week";
  if (item.planning && days !== null && days <= PLANNING_LEAD_DAYS) return "this_week";
  return "all_good";
}

const LEVEL_RANK: Record<Level, number> = { high: 0, moderate: 1, unknown: 2, low: 3, none: 4 };
const CONF_RANK: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 };

/** Order inside a group: deadline (soonest, none last), then level, then confidence (S-04.01). */
export function compareItems(
  a: { deadline: string | null; level: Level; confidence: ConfidenceLevel },
  b: { deadline: string | null; level: Level; confidence: ConfidenceLevel },
): number {
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  }
  return LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || CONF_RANK[a.confidence] - CONF_RANK[b.confidence];
}
