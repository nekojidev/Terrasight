/** Pure helpers of the home page (brief): plain-language headline and dates inside text. */

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
