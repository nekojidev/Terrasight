"use client";

import { Disclosure, Kicker, Surface } from "@terrasight/ui";
import { useTranslations } from "next-intl";
import { displayText, type Aliases } from "@/lib/assistant-text";
import { useFormat } from "@/lib/useFormat";

/** The tools the assistant can call (apps/api/src/assistant); each has a plain title in `Assistant.toolName`. */
export const TOOL_NAMES = [
  "list_fields",
  "get_brief",
  "get_field_summary",
  "get_field_history",
  "get_weather",
  "get_forecast",
  "list_recommendations",
  "explain_recommendation",
  "run_risk_model",
  "compare",
  "get_pest_info",
  "get_climate_shift",
  "get_year_set_ranking",
] as const;

/** Fields that are bookkeeping, never worth a labelled row (unknown fields are never printed either: no developer keys). */
const HIDDEN = new Set(["id", "region", "state", "provider", "saved", "hasVerifiedModel", "source", "regions", "kind", "issuedAt", "dataset", "mode", "genericWindow", "thresholdVerified", "planning", "currency"]);
/** Numbers that are years or counters: shown without a thousands separator. */
const PLAIN_NUMBER = new Set(["season", "since", "stressYearCount", "from", "to", "baselineFrom", "baselineTo", "recentFrom", "recentTo", "firstYear", "lastYear", "yearsUsed", "rank"]);
/** Model-facing caveats and machine reasons: never shown as rows. */
const SKIP = new Set(["note", "kind", "reason"]);
const MAX_ROWS = 40;
/** Rows shown at once; the rest sit behind "All rows". */
export const VISIBLE_ROWS = 3;

export interface CardRow {
  label: string;
  value: string;
}
export interface CardGroup {
  title: string | null;
  rows: CardRow[];
}

/** "meanTemperature" → "Mean temperature": the plain-text fallback for fields without a label. */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Fmt = ReturnType<typeof useFormat>;
type Translate = (key: string, values?: Record<string, string | number>) => string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
const ENUMISH = /^[a-z][a-z0-9_]*$/;

/** A number with its unit, through the shared formatters. */
export function formatQuantity(value: number, unit: string, fmt: Fmt, t: Translate): string {
  switch (unit) {
    case "mm":
      return fmt.rain(value);
    case "°C":
      // As many decimals as the tool result carries (at most 2), so the card shows the numbers the answer quotes.
      return fmt.temp(value, Math.min(2, (String(value).split(".")[1] ?? "").length));
    case "ha":
      return fmt.area(value);
    case "share":
      return fmt.percent(value);
    case "%":
      return `${fmt.number(value, { maximumFractionDigits: 1 })} %`;
    case "days":
      return `${fmt.number(value)} ${t("days")}`;
    case "km":
      return `${fmt.number(value)} ${t("unit_km")}`;
    case "degree-days":
      return `${fmt.number(value)} ${t("unit_degreeDays")}`;
    case "day of year":
      return `${t("unit_dayOfYear")} ${fmt.number(value)}`;
    case "":
      return fmt.number(value);
    default:
      return `${fmt.number(value)} ${unit}`;
  }
}

/** Builds labelled rows (known fields) and plain details (everything else) from a tool result. */
export function buildCard(
  result: unknown,
  ctx: { fmt: Fmt; t: Translate; has: (key: string) => boolean; aliases: Aliases; lang: "en" | "uk" },
): { groups: CardGroup[] } {
  const { fmt, t, has, aliases, lang } = ctx;
  const groups: CardGroup[] = [];
  let count = 0;
  const known = (k: string) => !HIDDEN.has(k) && has(`label.${k}`);
  const label = (k: string) => t(`label.${k}`);

  const rowsOf = (title: string | null): CardRow[] => {
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, rows: [] }));
    return g.rows;
  };
  const place = (key: string, value: string | null, title: string | null) => {
    // Fields without a farmer's label are hidden, never printed with their developer key.
    if (value === null || count >= MAX_ROWS || !known(key)) return;
    count++;
    rowsOf(title).push({ label: label(key), value });
  };
  const text = (key: string, s: string): string | null => {
    if (ISO_DATE.test(s)) return fmt.date(s, "full");
    if (has(`val.${s}`)) return t(`val.${s}`);
    // Raw codes ("us_great_plains", "urgent") are never shown as words; they go to details as they are.
    if (ENUMISH.test(s) && !(key === "title" || key === "name")) return null;
    return displayText(s, aliases, lang);
  };
  const primitive = (key: string, v: unknown, title: string | null) => {
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "boolean") return place(key, v ? t("yes") : t("no"), title);
    if (typeof v === "number") {
      const s = PLAIN_NUMBER.has(key)
        ? String(v)
        : key === "confidence" && v <= 1
          ? fmt.percent(v)
          : fmt.number(v, { maximumFractionDigits: 2 });
      return place(key, s, title);
    }
    const s = text(key, String(v));
    if (s === null) return;
    place(key, s, title);
  };
  const heading = (o: Record<string, unknown>): { text: string; key: string } | null => {
    for (const k of ["title", "name", "date", "field", "season", "pest"]) {
      const v = o[k];
      if (typeof v === "string" || typeof v === "number") {
        const s = typeof v === "string" && ISO_DATE.test(v) ? fmt.date(v, "full") : displayText(String(v), aliases, lang);
        if (!ENUMISH.test(s)) return { text: s, key: k };
      }
    }
    return null;
  };
  const walk = (node: unknown, key: string, title: string | null) => {
    if (node === null || node === undefined || count >= MAX_ROWS) return;
    if (Array.isArray(node)) {
      if (node.every((x) => x === null || typeof x !== "object")) {
        const s = node.filter((x) => x !== null && x !== undefined).map((x) => (typeof x === "number" ? fmt.number(x) : displayText(String(x), aliases, lang)));
        const shown = s.filter((x) => !ENUMISH.test(x));
        if (shown.length === s.length && s.length) place(key, s.join(", "), title);
        return;
      }
      node.forEach((item, i) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const h = heading(o);
          const head = h?.text ?? (known(key) ? `${label(key)} ${i + 1}` : title);
          for (const [k, v] of Object.entries(o)) if (k !== h?.key) walk(v, k, head);
        } else walk(item, key, title);
      });
      return;
    }
    if (typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (typeof o.value === "number" && "unit" in o) return place(key, formatQuantity(o.value, String(o.unit ?? ""), fmt, t), title);
      const sub = title ?? (key && known(key) ? label(key) : null);
      for (const [k, v] of Object.entries(o)) {
        if (SKIP.has(k)) continue;
        // A field name that is only a flag ("source") hides in details even if nested.
        walk(v, k, sub);
      }
      return;
    }
    primitive(key, node, title);
  };
  walk(result, "", null);
  // Rows with no group first.
  groups.sort((a, b) => Number(a.title !== null) - Number(b.title !== null));
  return { groups };
}

/** Whether the answer quotes this row value (its numbers, or the word itself). */
function quoted(value: string, answer: string): boolean {
  const a = answer.toLowerCase();
  const nums = value.match(/\d[\d.,]*\d|\d/g) ?? [];
  if (nums.length) return nums.some((n) => a.includes(n) || a.includes(n.replace(",", ".")) || a.includes(n.replace(".", ",")));
  return value.length >= 3 && a.includes(value.toLowerCase());
}

/** The first `limit` rows (rows the answer quotes come first, then card order) and the groups of the rest. */
export function splitRows(
  groups: CardGroup[],
  answer: string,
  limit = VISIBLE_ROWS,
): { shown: CardGroup[]; rest: CardGroup[]; total: number } {
  const flat = groups.flatMap((g, gi) => g.rows.map((r, ri) => ({ gi, ri, r })));
  const picked = new Set<string>();
  const mark = (x: { gi: number; ri: number }) => picked.add(`${x.gi}:${x.ri}`);
  if (answer) for (const x of flat) if (picked.size < limit && quoted(x.r.value, answer)) mark(x);
  for (const x of flat) if (picked.size < limit) mark(x);
  const part = (want: boolean): CardGroup[] =>
    groups
      .map((g, gi) => ({ title: g.title, rows: g.rows.filter((_, ri) => picked.has(`${gi}:${ri}`) === want) }))
      .filter((g) => g.rows.length > 0);
  return { shown: part(true), rest: part(false), total: flat.length };
}

function Rows({ groups }: { groups: CardGroup[] }) {
  return (
    <>
      {groups.map((g, gi) => (
        <div key={`${gi}:${g.title ?? ""}`} className="mb-3 min-w-0 last:mb-0">
          {g.title && <p className="mb-1 text-caption font-semibold break-words text-ink">{g.title}</p>}
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[240px] text-caption">
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={`${i}:${r.label}`} className="border-b border-line last:border-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal break-words text-ink-2">
                      {r.label}
                    </th>
                    <td className="py-1.5 text-right break-words text-ink">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/** A tool result as a plain card: a title and at most 3 labelled rows with units (the ones the answer quotes); the rest behind "All rows". */
export function ToolCard({
  tool,
  result,
  aliases,
  lang,
  answer = "",
}: {
  tool: string;
  result: unknown;
  aliases: Aliases;
  lang: "en" | "uk";
  /** The answer text, so that the rows it quotes come first. */
  answer?: string;
}) {
  const a = useTranslations("Assistant");
  const fmt = useFormat();
  const t: Translate = (key, values) => a(key as never, values as never);
  const has = (key: string) => a.has(key as never);
  const title = (TOOL_NAMES as readonly string[]).includes(tool) ? a(`toolName.${tool}` as never) : a("toolUnknown");
  const { groups } = buildCard(result, { fmt, t, has, aliases, lang });
  const { shown, rest, total } = splitRows(groups, answer);
  return (
    <Surface tone="inset" pad="sm" className="min-w-0">
      <Kicker as="h4" className="mb-2 break-words">
        {title}
      </Kicker>
      <Rows groups={shown} />
      {rest.length > 0 && (
        <Disclosure summary={<span className="text-caption">{a("allRows", { n: total })}</span>}>
          <Rows groups={rest} />
        </Disclosure>
      )}
    </Surface>
  );
}
