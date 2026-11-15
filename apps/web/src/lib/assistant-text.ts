/** Display-only text fixes for assistant answers (the stored text keeps aliases and ISO dates; the model never sees names). */

export type Aliases = Record<string, { id?: string; name: string }>;

/** Field aliases (F3) back to the company's field names, only in the browser (RFC §12.6). */
export function restoreAliases(text: string, aliases: Aliases): string {
  // Letter lookarounds instead of \b: JS \b is ASCII-only, so "поліF1" must still match and "F1x" must not.
  return text.replace(/(?<![\p{L}\p{N}])F(\d+)(?![\p{L}\p{N}])/gu, (m) => aliases[m]?.name ?? m);
}

const MONTHS: Record<"en" | "uk", string[]> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  // Genitive: "5 вересня".
  uk: [
    "січня",
    "лютого",
    "березня",
    "квітня",
    "травня",
    "червня",
    "липня",
    "серпня",
    "вересня",
    "жовтня",
    "листопада",
    "грудня",
  ],
};

function valid(m: number, d: number, y?: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const max = new Date(Date.UTC(y ?? 2000, m, 0)).getUTCDate();
  return d <= max;
}

function dayMonth(m: number, d: number, lang: "en" | "uk"): string {
  const name = MONTHS[lang][m - 1]!;
  return lang === "uk" ? `${d} ${name}` : `${name} ${d}`;
}

/** ISO dates (2026-09-05) and month-day pairs (09-10) in the UI language: "5 вересня 2026" / "September 5, 2026". */
export function formatDates(text: string, lang: "en" | "uk"): string {
  const full = text.replace(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g, (raw, y: string, m: string, d: string) =>
    valid(+m, +d, +y) ? (lang === "uk" ? `${dayMonth(+m, +d, lang)} ${y}` : `${dayMonth(+m, +d, lang)}, ${y}`) : raw,
  );
  return full.replace(/(?<![\d\-.:/])(\d{2})-(\d{2})(?![\d\-:/])(?!\.\d)(?!\s*(?:mm|cm|m\b|km|ha|kg|%|°|days?|мм|см|км|га|кг|дн))/gu, (raw, m: string, d: string) =>
    valid(+m, +d) ? dayMonth(+m, +d, lang) : raw,
  );
}

/** What the chat shows: field names restored, dates in the UI language. */
export function displayText(text: string, aliases: Aliases, lang: "en" | "uk"): string {
  return formatDates(restoreAliases(text, aliases), lang);
}

/** The language an answer is written in, judged by its letters; null when there are too few to tell. */
export function answerLang(text: string): "en" | "uk" | null {
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyr + lat < 12) return null;
  return cyr > lat ? "uk" : "en";
}
