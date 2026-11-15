/**
 * Number check (RFC §12.4, Tech Design §12.2): every number in an answer sentence must come from the turn's tool
 * results (exactly, at display precision or in a supported unit conversion), or be list numbering. Numbers that
 * appear only in the user's question are NOT allowed back: the answer must take them from a tool result. The model never does arithmetic: differences come from the `compare` tool.
 */

export type Lang = "en" | "uk";

/** A number in a tool result tagged with its unit and display precision (S-05.01). */
export interface Quantity {
  value: number;
  unit?: string;
  /** Decimals shown in the UI. */
  precision?: number;
}

export interface Extracted {
  raw: string;
  kind: "number" | "percent" | "date" | "word";
  /** Numeric value (numbers, percents, words). */
  value?: number;
  /** Decimals as written. */
  decimals?: number;
  /** Month-day as "MM-DD", plus the year when written. */
  date?: { md: string; year?: number };
  /** "15.04" could also be a decimal: accepted if either reading is allowed. */
  alt?: { value: number; decimals: number };
}

const WORDS: Record<Lang, Record<string, number>> = {
  en: {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
    thousand: 1000,
    once: 1,
    twice: 2,
  },
  uk: {
    нуль: 0,
    один: 1,
    одна: 1,
    одне: 1,
    одного: 1,
    одній: 1,
    два: 2,
    дві: 2,
    двох: 2,
    двома: 2,
    три: 3,
    трьох: 3,
    чотири: 4,
    чотирьох: 4,
    "п'ять": 5,
    "п’ять": 5,
    пʼять: 5,
    шість: 6,
    сім: 7,
    вісім: 8,
    "дев'ять": 9,
    "дев’ять": 9,
    десять: 10,
    одинадцять: 11,
    дванадцять: 12,
    тринадцять: 13,
    чотирнадцять: 14,
    "п'ятнадцять": 15,
    "п’ятнадцять": 15,
    шістнадцять: 16,
    сімнадцять: 17,
    вісімнадцять: 18,
    "дев'ятнадцять": 19,
    "дев’ятнадцять": 19,
    двадцять: 20,
    тридцять: 30,
    сорок: 40,
    "п'ятдесят": 50,
    "п’ятдесят": 50,
    шістдесят: 60,
    сімдесят: 70,
    вісімдесят: 80,
    "дев'яносто": 90,
    "дев’яносто": 90,
    сто: 100,
    двісті: 200,
    триста: 300,
    чотириста: 400,
    "п'ятсот": 500,
    "п’ятсот": 500,
    шістсот: 600,
    сімсот: 700,
    вісімсот: 800,
    "дев'ятсот": 900,
    "дев’ятсот": 900,
    тисяча: 1000,
    тисячі: 1000,
    тисяч: 1000,
    двічі: 2,
    тричі: 3,
  },
};

const MONTHS: Array<[RegExp, number]> = [
  [/^(jan(uary)?|січ(ня|ень)?)$/i, 1],
  [/^(feb(ruary)?|лют(ого|ий)?)$/i, 2],
  [/^(mar(ch)?|берез(ня|ень)?)$/i, 3],
  [/^(apr(il)?|квіт(ня|ень)?)$/i, 4],
  [/^(may|трав(ня|ень)?)$/i, 5],
  [/^(jun(e)?|черв(ня|ень)?)$/i, 6],
  [/^(jul(y)?|лип(ня|ень)?)$/i, 7],
  [/^(aug(ust)?|серп(ня|ень)?)$/i, 8],
  [/^(sep(t(ember)?)?|верес(ня|ень)?)$/i, 9],
  [/^(oct(ober)?|жовт(ня|ень)?)$/i, 10],
  [/^(nov(ember)?|листопад(а)?)$/i, 11],
  [/^(dec(ember)?|груд(ня|ень)?)$/i, 12],
];
const MONTH_WORD = "[A-Za-zА-Яа-яІіЇїЄєҐґ]{3,10}";
const month = (w: string): number | null => MONTHS.find(([re]) => re.test(w))?.[1] ?? null;
const md = (m: number, d: number) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validDay = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** Removes things that look like numbers but aren't quantities: field aliases (F12), list markers, model ids. */
function scrub(sentence: string): string {
  return sentence
    .replace(/\bF\d+\b/g, " ")
    .replace(/^\s*(\d{1,2}[.)]|[-•*])\s+/, " ")
    // Only known identifiers hide their digits; "NASA 2025" or "USDA 300 mm" still count as numbers.
    .replace(/\bFAO[-\s]?(?:56|33)\b/g, " ")
    .replace(/\bSCS-CN\b/g, " ")
    .replace(/\b(?:USDA|NASA)\s+(?:CDL|SSURGO|NASS|AMS|POWER|SMAP|GPM|MODIS)\b/g, " ")
    .replace(/\b(?:USDA|NASA|FAO|SCS|ICBM|RUSLE)\b/g, " ")
    .replace(/\bMF\d+\b/g, " ")
    .replace(/\bSentinel-2\b/gi, " ")
    .replace(/\bGLO-30\b/g, " ")
    .replace(/\bCO2\b|\bCO₂\b/g, " ");
}

/** Numbers, percents, ranges, dates and number words 0–20 in a sentence. */
export function extractNumbers(sentence: string, lang: Lang): Extracted[] {
  let s = scrub(sentence);
  const out: Extracted[] = [];
  const take = (re: RegExp, fn: (m: RegExpExecArray) => Extracted | Extracted[] | null) => {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const r = fn(m);
      if (!r) return m[0];
      out.push(...(Array.isArray(r) ? r : [r]));
      return " ";
    });
  };
  // ISO dates 2026-11-14
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => ({
    raw: m[0],
    kind: "date",
    date: { md: `${m[2]}-${m[3]}`, year: Number(m[1]) },
  }));
  // 25.04 / 25.04.2027 (the Ukrainian UI date format; in English a dot is a decimal point)
  if (lang === "uk")
    take(/\b(\d{1,2})\.(\d{2})(?:\.(\d{4}))?\b(?![.,]\d)/g, (m) => {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      if (!validDay(mo, d)) return null;
      return {
        raw: m[0],
        kind: "date",
        date: { md: md(mo, d), ...(m[3] ? { year: Number(m[3]) } : {}) },
        ...(m[3] ? {} : { alt: { value: Number(`${m[1]}.${m[2]}`), decimals: 2 } }),
      };
    });
  // "Apr 25", "April 25, 2027"
  take(new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, "g"), (m) => {
    const mo = month(m[1]!);
    const d = Number(m[2]);
    if (!mo || !validDay(mo, d)) return null;
    return { raw: m[0], kind: "date", date: { md: md(mo, d), ...(m[3] ? { year: Number(m[3]) } : {}) } };
  });
  // Day ranges before a month: "14–15 листопада", "14-15 November" → two dates.
  take(new RegExp(`\\b(\\d{1,2})\\s*[–-]\\s*(\\d{1,2})\\s+(${MONTH_WORD})`, "g"), (m) => {
    const mo = month(m[3]!);
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    if (!mo || !validDay(mo, d1) || !validDay(mo, d2)) return null;
    return [
      { raw: m[0], kind: "date" as const, date: { md: md(mo, d1) } },
      { raw: m[0], kind: "date" as const, date: { md: md(mo, d2) } },
    ];
  });
  // "25 April", "25 квітня 2027"
  take(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_WORD})(?:\\s+(\\d{4}))?`, "g"), (m) => {
    const mo = month(m[2]!);
    const d = Number(m[1]);
    if (!mo || !validDay(mo, d)) return null;
    return { raw: m[0], kind: "date", date: { md: md(mo, d), ...(m[3] ? { year: Number(m[3]) } : {}) } };
  });
  // Numbers with optional thousands separators, decimals (. or ,), a sign and a percent sign; ranges become two.
  take(/[−-]?\d{1,3}(?:[ ,\u202f\u00a0]\d{3})+(?:[.,]\d+)?%?|[−-]?\d+(?:[.,]\d+)?%?/g, (m) => {
    let raw = m[0];
    const percent = raw.endsWith("%");
    if (percent) raw = raw.slice(0, -1);
    // A leading hyphen right after a digit is a range dash ("2024-2025"), not a sign: the regex consumed it.
    const negative = /^[−-]/.test(raw);
    raw = raw.replace(/^[−-]/, "");
    let norm = raw.replace(/[\u202f\u00a0 ]/g, "");
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(norm)) norm = norm.replace(/,/g, "");
    else norm = norm.replace(",", ".");
    const value = Number(norm) * (negative ? -1 : 1);
    if (Number.isNaN(value)) return null;
    const decimals = norm.includes(".") ? norm.split(".")[1]!.length : 0;
    return { raw: m[0], kind: percent ? "percent" : "number", value, decimals };
  });
  // Number words: 0–20, tens and hundreds; adjacent words combine ("twenty-five", "two hundred and ten",
  // "двадцять п'ять", "двісті десять").
  const words = WORDS[lang];
  const all = [...s.toLowerCase().matchAll(/[\p{L}'’ʼ]+/gu)].map((m) => ({
    w: m[0],
    start: m.index!,
    end: m.index! + m[0].length,
  }));
  // "two hundred AND ten": the "and" joins number words (English only), so it is dropped between them.
  const tokens = all.filter(
    (t, k) => !(lang === "en" && t.w === "and" && (all[k - 1]?.w ?? "") in words && (all[k + 1]?.w ?? "") in words),
  );
  let i = 0;
  while (i < tokens.length) {
    const t0 = tokens[i]!;
    if (!(t0.w in words)) {
      i++;
      continue;
    }
    let value = words[t0.w]!;
    let raw = t0.w;
    let j = i + 1;
    while (j < tokens.length) {
      const prev = tokens[j - 1]!;
      const next = tokens[j]!;
      const gap = s.slice(prev.end, next.start).toLowerCase();
      const joined = /^[\s-]+$/.test(gap) || (lang === "en" && /^\s+and\s+$/.test(gap));
      if (!joined || !(next.w in words)) break;
      const nv = words[next.w]!;
      if (nv === 100 && value >= 1 && value <= 9) value *= 100;
      else if (nv === 1000 && value >= 1 && value < 1000) value *= 1000;
      else if (value % 100 === 0 && value >= 100 && nv < 100 && nv > 0) value += nv;
      else if (value >= 20 && value < 100 && value % 10 === 0 && nv >= 1 && nv <= 9) value += nv;
      else if (value >= 1000 && value % 1000 === 0 && nv < 1000 && nv > 0) value += nv;
      else break;
      raw += ` ${next.w}`;
      j++;
    }
    out.push({ raw, kind: "word", value, decimals: 0 });
    i = j;
  }
  return out;
}

const CONVERSIONS: Record<string, Array<(v: number) => number>> = {
  "°C": [(c) => (c * 9) / 5 + 32],
  mm: [(v) => v / 25.4],
  ha: [(v) => v * 2.471054],
  "$/ha": [(v) => v / 2.471054],
  "t/ha": [(v) => v * 0.44609], // short tons per acre
  "°C·d": [(v) => (v * 9) / 5],
  m: [(v) => v / 0.3048, (v) => v / 1609.344],
};

/** Allowed values for a turn: tool numbers (+ display precision, conversions, shares as %), dates, question numbers. */
export class AllowedSet {
  /** Value and the finest rounding allowed (decimals); null = any rounding to whole numbers or finer. */
  private readonly values: Array<{ v: number; p: number | null }> = [];
  private readonly dates = new Set<string>();
  private readonly years = new Set<number>();

  addNumber(v: number, unit?: string, precision?: number): void {
    if (!Number.isFinite(v)) return;
    const p = precision ?? null;
    this.values.push({ v, p });
    if (v > 0 && v <= 1) this.values.push({ v: v * 100, p: p === null ? null : Math.max(0, p - 2) }); // shares as %
    for (const f of CONVERSIONS[unit ?? ""] ?? []) this.values.push({ v: f(v), p });
    if (Number.isInteger(v) && v >= 1900 && v <= 2100) this.years.add(v);
  }

  addDate(iso: string): void {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return;
    this.dates.add(`${m[2]}-${m[3]}`);
    this.years.add(Number(m[1]));
  }

  /** Walks a tool result: `{ value, unit, precision }` quantities, plain numbers, ISO date strings, numeric strings. */
  addResult(node: unknown, unit?: string): void {
    if (node === null || node === undefined) return;
    if (typeof node === "number") return this.addNumber(node, unit);
    if (typeof node === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(node)) return this.addDate(node);
      if (/^-?\d+(\.\d+)?$/.test(node)) return this.addNumber(Number(node), unit);
      // Numbers inside tool text ("crop for 2026 not known yet", "Plan for 2027: …") are tool output too.
      for (const n of node.match(/\d{4}-\d{2}-\d{2}/g) ?? []) this.addDate(n);
      for (const e of [...extractNumbers(node, "en"), ...extractNumbers(node, "uk")]) {
        if (e.value !== undefined) this.addNumber(e.value, undefined, e.decimals);
        if (e.date) {
          this.dates.add(e.date.md);
          if (e.date.year) this.years.add(e.date.year);
        }
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((x) => this.addResult(x, unit));
    if (typeof node === "object") {
      const o = node as Record<string, unknown>;
      const quantity = typeof o.value === "number" && ("unit" in o || "precision" in o);
      if (quantity)
        this.addNumber(
          o.value as number,
          typeof o.unit === "string" ? o.unit : unit,
          typeof o.precision === "number" ? o.precision : undefined,
        );
      // Other keys of the object (dates, labels, nested results) still count.
      for (const [k, v] of Object.entries(o))
        if (!quantity || (k !== "value" && k !== "unit" && k !== "precision")) this.addResult(v, unit);
    }
  }

  /** Numbers the user wrote are allowed back. */
  addText(text: string, lang: Lang): void {
    for (const e of extractNumbers(text, lang)) {
      if (e.value !== undefined) this.addNumber(e.value, undefined, e.decimals);
      if (e.date) {
        this.dates.add(e.date.md);
        if (e.date.year) this.years.add(e.date.year);
      }
    }
  }

  private number(n: number, d: number): boolean {
    if (Number.isInteger(n) && n >= 1900 && n <= 2100 && this.years.has(n)) return true;
    const scale = 10 ** d;
    return this.values.some(({ v, p }) => {
      if (Math.abs(v - n) < 1e-9 || Math.abs(Math.abs(v) - Math.abs(n)) < 1e-9) return true;
      if (p !== null && d < p) return false; // coarser than the UI shows
      const r = Math.round(Math.abs(v) * scale) / scale;
      return Math.abs(r - Math.abs(n)) < 1e-9;
    });
  }

  allows(e: Extracted): boolean {
    if (e.kind === "date") {
      const ok = this.dates.has(e.date!.md) && (e.date!.year === undefined || this.years.has(e.date!.year));
      return ok || (e.alt !== undefined && this.number(e.alt.value, e.alt.decimals));
    }
    return this.number(e.value!, e.decimals ?? 0);
  }
}

export interface SentenceCheck {
  ok: boolean;
  numbers: number;
  failed: Extracted[];
}

/** Checks one sentence against the allowed set. */
export function checkSentence(sentence: string, allowed: AllowedSet, lang: Lang): SentenceCheck {
  const found = extractNumbers(sentence, lang);
  const failed = found.filter((e) => !allowed.allows(e));
  return { ok: failed.length === 0, numbers: found.length, failed };
}

/** Sentences in UI language order (Intl.Segmenter, uk / en). */
export function splitSentences(text: string, lang: Lang): string[] {
  const seg = new Intl.Segmenter(lang === "uk" ? "uk" : "en", { granularity: "sentence" });
  return [...seg.segment(text)].map((s) => s.segment).filter((s) => s.trim().length > 0);
}
