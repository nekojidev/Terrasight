/**
 * Pure logic of the season form's stages (Planned, Sown, Emerged). A stage follows what the agronomist has
 * confirmed, never what the app estimated: sowing counts only when it is `confirmed`, emergence likewise.
 */

export type Stage = "planned" | "sown" | "emerged";
type Source = "confirmed" | "plan" | "estimate" | "regional" | "unknown";

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/** Today as an ISO date, in UTC (the API's convention for season dates). */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

/** Mark-as-sown pre-fills today when it is within this many days of the planned date. */
export const SOWN_TODAY_WINDOW_DAYS = 7;
/** The emergence question appears this many days before the expected date. */
export const EMERGENCE_LEAD_DAYS = 3;
/** "Not yet" hides the emergence question for this many days. */
export const EMERGENCE_SNOOZE_DAYS = 3;

export function deriveStage(rec: {
  sowingDate: { value: string | null; source: Source };
  emergenceDate: { value: string | null; source: Source };
}): Stage {
  const confirmed = (r: { value: string | null; source: Source }) => !!r.value && r.source === "confirmed";
  if (confirmed(rec.emergenceDate)) return "emerged";
  return confirmed(rec.sowingDate) ? "sown" : "planned";
}

/** Default date of "Mark as sown": today if within +-7 days of the planned date, else the planned date. */
export function markSownDefault(planned: string | null, today: string): string {
  if (!planned) return today;
  return Math.abs(daysBetween(planned, today)) <= SOWN_TODAY_WINDOW_DAYS ? today : planned;
}

/**
 * Whether to ask "Have the seedlings come up?": sown, not emerged yet, the expected date is near or past, and the
 * prompt is not snoozed (`snoozedUntil` is the first day it may show again).
 */
export function emergencePromptDue(args: {
  stage: Stage;
  expected: string | null;
  today: string;
  snoozedUntil?: string | null;
}): boolean {
  if (args.stage !== "sown" || !args.expected) return false;
  if (args.snoozedUntil && args.today < args.snoozedUntil) return false;
  return args.today >= addDays(args.expected, -EMERGENCE_LEAD_DAYS);
}

export const snoozeUntil = (today: string) => addDays(today, EMERGENCE_SNOOZE_DAYS);

/** Pre-filled date of "Yes, on ...": the expected date, but never in the future. */
export function emergenceDefault(expected: string | null, today: string): string {
  return expected && expected < today ? expected : today;
}

/** The one friendly next step shown instead of a list of missing values. */
export type NextStep = "crop" | "sowing" | "emergence" | "done";
export function nextStep(stage: Stage, hasCrop: boolean): NextStep {
  if (!hasCrop) return "crop";
  return stage === "planned" ? "sowing" : stage === "sown" ? "emergence" : "done";
}
