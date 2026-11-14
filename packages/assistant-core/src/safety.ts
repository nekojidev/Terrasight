import type { Lang } from "./number-check.js";

/** Replacement for a sentence with a dose or a product / active ingredient (RFC §12.5, Tech Design §12.3). */
export const TREATMENT_TEXT: Record<Lang, string> = {
  en: "Choice of treatment and dose: follow the product label and local rules.",
  uk: "Вибір засобу й норми: дотримуйтеся етикетки препарату та місцевих правил.",
};

/** An amount with a per-area or per-volume unit, EN and UA. */
const DOSE =
  /\d+(?:[.,]\d+)?\s*(?:–|-|to|до)?\s*(?:\d+(?:[.,]\d+)?\s*)?(?:l|L|kg|g|ml|mL|oz|fl\.?\s?oz|pt|qt|lb|gal|л|кг|г|мл)\s*(?:\/|per\s|на\s)\s*(?:ha|ac|acre|га|гектар|100\s?l|100\s?л)(?![\p{L}])/iu;

/** Parses `data/safety/actives.txt`: one name per line, `#` comments. */
export function parseActives(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter((l) => l.length >= 4);
}

export interface SafetyFilter {
  /** Returns the sentence, or the treatment text when it names a dose or a product. */
  sentence(s: string, lang: Lang): { text: string; blocked: "dose" | "product" | null };
}

export function createSafetyFilter(actives: string[]): SafetyFilter {
  const escaped = actives.map((a) => a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const names = escaped.length ? new RegExp(`(?<![\\p{L}])(?:${escaped.join("|")})(?![\\p{L}])`, "iu") : null;
  return {
    sentence(s, lang) {
      if (DOSE.test(s)) return { text: TREATMENT_TEXT[lang], blocked: "dose" };
      if (names?.test(s.toLowerCase())) return { text: TREATMENT_TEXT[lang], blocked: "product" };
      return { text: s, blocked: null };
    },
  };
}

export type RefusalKind = "product" | "chemical_price" | "legal" | "off_topic";

const REFUSAL_PATTERNS: Array<[RefusalKind, RegExp]> = [
  [
    "chemical_price",
    /\b(price|cost|how much)\b.*\b(pesticide|herbicide|fungicide|insecticide|chemical|spray)s?\b|(ціна|вартість|скільки коштує).*(пестицид|гербіцид|фунгіцид|інсектицид|хімі|препарат)/iu,
  ],
  [
    "product",
    /\b(which|what|best|recommend)\b.*\b(pesticides?|herbicides?|fungicides?|insecticides?|products?|sprays?|chemicals?)\b|\b(dose|rate|dosage)\b.*\b(per|\/)\s*(ha|acre|ac)\b|(який|яким|яку|які|порадь|норм[аиу]).*(препарат|пестицид|гербіцид|фунгіцид|інсектицид|засіб|засоб|обприск)|норм[аиу] внесення/iu,
  ],
  [
    "legal",
    /\b(legal|law|lawsuit|sue|regulation|permit|liable|liability)\b|(закон|юрид|позов|судитися|ліценз|відповідальніст)/iu,
  ],
];

/** Questions answered with a short refusal template instead of the model (RFC §12.5). */
export function classifyRefusal(question: string): RefusalKind | null {
  for (const [kind, re] of REFUSAL_PATTERNS) if (re.test(question)) return kind;
  return null;
}

export const REFUSALS: Record<RefusalKind, Record<Lang, string>> = {
  product: {
    en: "I don't recommend crop-protection products or doses. I can explain the risk, when to scout and what prevention the extension sources describe; for a product and its rate, follow the label and your local adviser.",
    uk: "Я не раджу засоби захисту рослин і норми. Можу пояснити ризик, коли оглядати поле і які профілактичні заходи описують університетські джерела; щодо препарату й норми дотримуйтеся етикетки та порад місцевого фахівця.",
  },
  chemical_price: {
    en: "I don't give prices of crop-protection products. I can show crop prices and margins from the rotation scenarios.",
    uk: "Я не називаю ціни засобів захисту рослин. Можу показати ціни культур і маржу зі сценаріїв сівозміни.",
  },
  legal: {
    en: "I can't give legal advice. Please check with your local extension office or a lawyer.",
    uk: "Я не даю юридичних порад. Зверніться до місцевої дорадчої служби або юриста.",
  },
  off_topic: {
    en: "I can help with your fields: risks, weather, history and rotation options.",
    uk: "Я допомагаю з вашими полями: ризики, погода, історія та варіанти сівозміни.",
  },
};

/** "10 years" in a rotation context → the 5-season wording (RFC §12.5). Returns the text and whether it changed. */
export function fixHorizon(s: string, lang: Lang): { text: string; changed: boolean } {
  const re =
    lang === "uk"
      ? /(10|десять|десяти)\s*(рок(ів|и)|сезон(ів|и))/gi
      : /\b(10|ten)[\s-]*(years?|seasons?)\b/gi;
  if (!re.test(s) || !/(rotation|сівозмін|plan|план|horizon|горизонт)/i.test(s))
    return { text: s, changed: false };
  const text = s.replace(re, lang === "uk" ? "5 сезонів (2026–2030)" : "5 seasons (2026–2030)");
  return { text, changed: true };
}
