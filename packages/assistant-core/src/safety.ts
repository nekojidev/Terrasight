import type { Lang } from "./number-check.js";

/** Replacement for a sentence with a dose or a product / active ingredient (RFC §12.5, Tech Design §12.3). */
export const TREATMENT_TEXT: Record<Lang, string> = {
  en: "Choice of treatment and dose: follow the product label and local rules.",
  uk: "Вибір засобу й норми: дотримуйтеся етикетки препарату та місцевих правил.",
};

// ---- dose patterns -------------------------------------------------------------------------------------------
// An amount (digits or a spelled-out number) + a mass / volume unit (symbol or spelled out) + "per" + an area or
// volume (hectare, acre, 100 L, 10 litres of water, ...). Filler words between the unit and "per" are allowed
// ("2 litres of product per hectare"). EN and UA, with UA inflections.
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const NUM_WORD = String.raw`(?:one and a half|a half|half|a quarter|quarter|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|півтора|пів|один|одну|два|дві|три|чотири|п['’]ять|шість|сім|вісім|дев['’]ять|десять|двадцять)`;
const QTY = String.raw`(?:${NUM}(?:\s*(?:–|-|to|до|or|чи|and)\s*${NUM})?|(?<![\p{L}])${NUM_WORD}(?![\p{L}]))`;
const UNIT = String.raw`(?:fl\.?\s?oz|fluid\s+ounces?|ounces?|oz|pints?|pt|quarts?|qt|pounds?|lbs?|gallons?|gal|cc|milli(?:l)?iters?|milli(?:l)?itres?|mls?|liters?|litres?|l|kilograms?|kilos?|kg|grams?|gr|g|mg|мілілітр(?:ів|и|а)?|мл|літр(?:ів|и|а)?|л|кілограм(?:ів|и|а)?|кг|грам(?:ів|и|а)?|г|мг|унці(?:й|ї|я|ю)?|фунт(?:ів|и|а)?|галон(?:ів|и|а)?)`;
const FILL = String.raw`(?:[\s,]+(?:of|from|in|diluted|product|formulation|material|chemical|active|ingredient|a\.?i\.?|ai|the|it|water|води|водою|препарату|продукту|речовини|діючої|розчину|розведеного|в|у|на|і)){0,5}`;
const PER = String.raw`(?:\s*\/\s*|[\s,]+(?:per|each|every|for\s+each|for\s+every|for|on|to|в\s+розрахунку\s+на|на|з|за|для)\s+)`;
const AREA = String.raw`(?:(?:one|a|an|the|each|every|кожен|кожного|один|одного|1)\s+)?(?:${NUM}\s*)?(?:hectares?|ha|acres?|ac|sq\.?\s?m|m2|m²|square\s+met(?:er|re)s?|гектар(?:а|и|ів|у|і)?|га|акр(?:а|ів|и|у)?|сот(?:ку|ки|ок|ка)|кв\.?\s?м|м2|м²|100\s?(?:l|L|литр\p{L}*|liters?|litres?|л|літр\p{L}*)|liters?|litres?|l|L|gallons?|gal|літр(?:ів|и|а)?|л|галон(?:ів|и|а)?|water|води)(?![\p{L}])`;
const DOSE = new RegExp(
  String.raw`(?<![\p{L}\d])${QTY}\s*${UNIT}(?![\p{L}])${FILL}${PER}${AREA}`,
  "iu",
);
/** Spelled-out rates without a number in front: "litres per hectare" / "літрів на гектар" after a number split off by markup. */
const DOSE_SPLIT = new RegExp(
  String.raw`(?<![\p{L}\d])${NUM}\s*(?:\r?\n|[\s,;:])+\s*${UNIT}(?![\p{L}])${FILL}${PER}${AREA}`,
  "iu",
);

/** Text normalisation before matching: NFKC, no soft hyphens or zero-width characters, one kind of space. */
export function normalizeForSafety(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2000-\u200A\u202F]/g, " ");
}

/** Cyrillic letters that look like Latin ones, folded so "glyphоsate" with a Cyrillic "о" still matches. */
const LOOKALIKE: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  к: "k",
  м: "m",
  н: "h",
  т: "t",
  в: "b",
};
const foldLookalikes = (s: string) => s.replace(/[аеорсхуікмнтв]/g, (c) => LOOKALIKE[c] ?? c);

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

/** A name matches as a whole word with inflections: UA cases (гліфосат → гліфосату, гліфосатом), EN plurals. */
function nameSource(a: string): string {
  const escaped = a
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "[\\s-]+");
  return escaped;
}

export function createSafetyFilter(actives: string[]): SafetyFilter {
  // Longer names tolerate a longer ending (Ukrainian case endings are up to 4 letters).
  const build = (names: string[]) =>
    names.length
      ? new RegExp(
          `(?<![\\p{L}\\d])(?:${names
            .map((n) => `${nameSource(n)}(?:\\p{L}{0,${n.length >= 7 ? 4 : 2}})`)
            .join("|")})(?![\\p{L}])`,
          "iu",
        )
      : null;
  const names = build(actives);
  const latin = build(actives.filter((a) => /^[ -~]+$/.test(a)));
  return {
    sentence(s, lang) {
      const n = normalizeForSafety(s);
      if (DOSE.test(n) || DOSE_SPLIT.test(n)) return { text: TREATMENT_TEXT[lang], blocked: "dose" };
      const low = n.toLowerCase();
      if (names?.test(low) || latin?.test(foldLookalikes(low))) return { text: TREATMENT_TEXT[lang], blocked: "product" };
      return { text: s, blocked: null };
    },
  };
}

export type RefusalKind = "product" | "chemical_price" | "legal" | "off_topic";

const CROP_CHEM = String.raw`(?:pesticides?|herbicides?|fungicides?|insecticides?|chemicals?|sprays?|spraying)`;
const CROP_CHEM_UA = String.raw`(?:пестицид|гербіцид|фунгіцид|інсектицид|хімі|препарат|отрутох|протруйник|засіб)`;
// `s` flag: a question may span lines; `[\s\S]` is not needed then.
const REFUSAL_PATTERNS: Array<[RefusalKind, RegExp]> = [
  [
    "chemical_price",
    new RegExp(
      String.raw`\b(?:price|prices|cost|costs|how much|cheap|cheapest|expensive|pay for)\b.*\b${CROP_CHEM}\b|\b${CROP_CHEM}\b.*\b(?:price|prices|cost|costs|how much|cheap|cheapest)\b|(?:ціна|ціни|вартість|скільки коштує|скільки коштують|дешев|дорог).*${CROP_CHEM_UA}|${CROP_CHEM_UA}.*(?:ціна|ціни|вартість|скільки коштує|скільки коштують|дешев)`,
      "isu",
    ),
  ],
  [
    "product",
    new RegExp(
      [
        String.raw`\b(?:which|what|best|recommend|suggest|good|name)\b.*\b(?:pesticides?|herbicides?|fungicides?|insecticides?|products?|sprays?|chemicals?|brands?)\b`,
        String.raw`\b(?:what|which)\b.*\b(?:should|can|do|to)\b.*\b(?:spray|apply|treat\s+with|tank[\s-]?mix)\b`,
        String.raw`\b(?:dose|doses|rate|rates|dosage|amount)\b.*\b(?:per|\/|a)\s*(?:ha|hectare|acre|ac)\b`,
        String.raw`\b(?:how much|how many (?:litres|liters|kilograms|kg|grams|ounces|pounds))\b.*\b(?:per|\/|a)\s*(?:ha|hectare|acre|ac)\b`,
        String.raw`\b(?:tank[\s-]?mix|application rate|label rate|mixing (?:ratio|rate))\b`,
        String.raw`(?:який|яким|яку|які|якого|якому|порадь|порадьте|підкажи|підкажіть|назви|назвіть|норм[аиуі]|доз[аиуі]|дозуванн).*(?:препарат|пестицид|гербіцид|фунгіцид|інсектицид|засіб|засоб|обприск|протруйник|отрутох)`,
        String.raw`(?:чим|що).*(?:обприск|обробит|обробляти|протруїт|боротис|захистит|травит)`,
        String.raw`(?:норм[аиуі]|дозуванн\p{L}*|доз[аиуі]) (?:внесення|витрат\p{L}*|препарату|на (?:га|гектар|10 л|100 л))`,
        String.raw`баков\p{L}+ суміш`,
      ].join("|"),
      "isu",
    ),
  ],
  [
    "legal",
    /\b(legal|law|lawsuit|sue|regulation|permit|liable|liability)\b|(закон|юрид|позов|судитися|ліценз|відповідальніст)/isu,
  ],
];

/** Questions answered with a short refusal template instead of the model (RFC §12.5). */
export function classifyRefusal(question: string): RefusalKind | null {
  const q = normalizeForSafety(question);
  for (const [kind, re] of REFUSAL_PATTERNS) if (re.test(q)) return kind;
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
