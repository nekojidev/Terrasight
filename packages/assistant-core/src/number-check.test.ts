import { describe, expect, it } from "vitest";
import { AllowedSet, checkSentence, extractNumbers, splitSentences, type Lang } from "./number-check.js";
import { classifyRefusal, createSafetyFilter, fixHorizon, parseActives, TREATMENT_TEXT } from "./safety.js";
import { functionDeclarations, parseArgs } from "./tools.js";

/** Tool results of a typical turn about Pivot 12 (F1) and Pivot 14 (F2). */
const RESULTS = [
  { prevent: "Знищте падалицю за два тижні до сівби." },
  { forecast: ["2026-11-25"] },
  {
    field: "F1",
    areaHa: { value: 47.63, unit: "ha", precision: 1 },
    slopePct: { value: 0.8, unit: "%", precision: 1 },
  },
  {
    seasons: [
      { season: 2024, crop: "corn" },
      { season: 2025, crop: "corn" },
    ],
    hostSeasonsInRow: { value: 2, unit: "seasons" },
  },
  {
    precipMm: { value: 284.2, unit: "mm", precision: 0 },
    tmeanC: { value: 15.36, unit: "°C", precision: 1 },
    percentile: { value: 92, unit: "percentile" },
    from: "2022-04-01",
    to: "2022-09-30",
  },
  { deadline: "2027-04-25", nextFrost: "2026-11-20", confidence: 0.8 },
  { a: 123, b: -185, diff: { value: 308, unit: "$/ha" } },
  { degreeDays: { value: 552.4, unit: "°C·d" } },
  { unknowns: ["crop for 2026 not known yet"] },
  {
    evidence: [{ source: "Crop history", from: "2019", to: "2019", value: 1, unit: "host seasons in a row" }],
  },
];

function allowed(question = "", lang: Lang = "en"): AllowedSet {
  const a = new AllowedSet();
  for (const r of RESULTS) a.addResult(r);
  void question; // numbers in the question are not allowed back
  void lang;
  return a;
}

const PASS: Array<[Lang, string, string?]> = [
  ["en", "F1 has had corn for 2 seasons in a row."],
  ["en", "Corn grew there in 2024 and 2025."],
  ["en", "The field covers 47.6 ha."],
  ["en", "That is about 117.7 ac."],
  ["en", "Summer 2022 brought only 284 mm of rain."],
  ["en", "That is 11.2 in of rain."],
  ["en", "The mean temperature was 15.4 °C."],
  ["en", "In Fahrenheit that is 59.6 °F."],
  ["en", "It was warmer than 92% of years."],
  ["en", "Decide by April 25, 2027."],
  ["en", "Decide by 25 April."],
  ["en", "Frost is expected on Nov 20."],
  ["en", "The alfalfa option earns $123 per ha more."],
  ["en", "The low-water option loses $185 per ha."],
  ["en", "The gap between them is $308/ha."],
  ["en", "Soil heat reached 552 °C·d."],
  ["en", "Soil heat reached 552.4 °C·d."],
  ["en", "Confidence is 80%."],
  ["en", "1. Change the crop for next season."],
  ["en", "There are two options worth comparing."],
  ["en", "The slope is 0.8%."],
  ["en", "The window ran from 2022-04-01 to 2022-09-30."],
  ["en", "Use USDA CDL and Sentinel-2 to check the history."],
  ["en", "Seasons 2024–2025 were both corn."],
  ["en", "Scout to confirm before acting."],
  ["en", "The crop for 2026 is not known yet."],
  ["en", "Corn has grown 1 season in a row, in 2019."],
  ["en", "F12 is not in this answer but F1 is."],
  ["uk", "На F1 кукурудза росте 2 сезони поспіль."],
  ["uk", "Кукурудза була у 2024 і 2025 роках."],
  ["uk", "Площа поля 47,6 га."],
  ["uk", "Влітку 2022 року випало лише 284 мм опадів."],
  ["uk", "Середня температура була 15,4 °C."],
  ["uk", "Це тепліше, ніж у 92% років.", ""],
  ["uk", "Рішення потрібне до 25.04.2027."],
  ["uk", "Рішення потрібне до 25 квітня."],
  ["uk", "Заморозки очікуються 20 листопада."],
  ["uk", "Варіант з люцерною дає на 123 $ з гектара більше."],
  ["uk", "Різниця становить 308 $/га."],
  ["uk", "Тепло ґрунту досягло 552 °C·д."],
  ["uk", "Є два варіанти, які варто порівняти."],
  ["uk", "Впевненість 80%."],
  ["uk", "Огляньте поле, щоб підтвердити."],
  ["uk", "Після дощів 20–25 листопада очікується потепління.", ""],
  ["uk", "Знищуйте падалицю щонайменше за 2 тижні до сівби."],
];

const FAIL: Array<[Lang, string]> = [
  // numbers only from the user's question, or hidden behind a source name, or spelled out beyond twenty
  ["en", "You asked about 3 fields, here is F2."],
  ["en", "NASA 2025 data show 300 mm."],
  ["en", "USDA 450 records say so."],
  ["en", "FAO 99 says to irrigate."],
  ["en", "It rained thirty days in a row."],
  ["en", "The field covers forty-eight ha."],
  ["en", "Soil heat reached six hundred °C·d."],
  ["en", "There were two hundred and ten mm."],
  ["uk", "Площа поля п'ятдесят га."],
  ["uk", "Випало двісті мм опадів."],
  ["uk", "Тривало двадцять п'ять днів."],
  ["uk", "NASA 2031 каже інакше."],
  ["en", "F1 has had corn for 3 seasons in a row."],
  ["en", "The field covers 48 ha."],
  ["en", "Summer 2022 brought 300 mm of rain."],
  ["en", "The mean temperature was 16 °C."],
  ["en", "It was warmer than 95% of years."],
  ["en", "Decide by April 15, 2027."],
  ["en", "Frost is expected on Nov 21."],
  ["en", "The alfalfa option earns $130 per ha more."],
  ["en", "Profit grows by 12% with alfalfa."],
  ["en", "Soil heat reached 600 °C·d."],
  ["en", "There are four options worth comparing."],
  ["en", "Corn grew there in 2018."],
  ["en", "Yields drop by 1.5 t/ha in a drought."],
  ["uk", "На F1 кукурудза росте 3 сезони поспіль."],
  ["uk", "Площа поля 50 га."],
  ["uk", "Влітку 2022 року випало 310 мм опадів."],
  ["uk", "Рішення потрібне до 15.04.2027."],
  ["uk", "Заморозки очікуються 22 листопада."],
  ["uk", "Різниця становить 300 $/га."],
  ["uk", "Є чотири варіанти, які варто порівняти."],
  ["uk", "Втрати врожаю сягають 20%."],
  ["uk", "Тепло ґрунту досягло 500 °C·д."],
];

describe("number check: passing sentences", () => {
  it.each(PASS)("[%s] %s", (lang, sentence, question) => {
    const r = checkSentence(sentence, allowed(question ?? "", lang), lang);
    expect(r.failed.map((f) => f.raw)).toEqual([]);
  });
});

describe("number check: failing sentences", () => {
  it.each(FAIL)("[%s] %s", (lang, sentence) => {
    expect(checkSentence(sentence, allowed("", lang), lang).ok).toBe(false);
  });
});

describe("extraction", () => {
  it("finds digits, decimals, percents, ranges, dates and number words", () => {
    const e = extractNumbers(
      "Between 2024–2025 F3 got 1,284.5 mm, 12% more, by Apr 25 and two weeks later.",
      "en",
    );
    expect(e.map((x) => x.kind).sort()).toEqual(["date", "number", "number", "number", "percent", "word"]);
    const uk = extractNumbers("До 25.04 випало 284,2 мм.", "uk");
    expect(uk.map((x) => x.kind)).toEqual(["date", "number"]);
    expect(e.find((x) => x.kind === "date")!.date!.md).toBe("04-25");
    expect(e.some((x) => x.value === 1284.5)).toBe(true);
  });
  it("counts at least 50 fixture sentences", () => {
    expect(PASS.length + FAIL.length).toBeGreaterThanOrEqual(50);
  });
  it("splits sentences in both languages", () => {
    expect(splitSentences("Corn grew in 2024. It grew again in 2025! Next?", "en")).toHaveLength(3);
    expect(
      splitSentences("Кукурудза була у 2024 р. І знову у 2025 році. Далі?", "uk").length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("safety filter (RFC §12.5)", () => {
  const filter = createSafetyFilter(parseActives("# test list\nglyphosate\nгліфосат\nimidacloprid\n"));
  it("replaces doses in EN and UA", () => {
    expect(filter.sentence("Apply 1.5 l/ha at the first sign.", "en")).toEqual({
      text: TREATMENT_TEXT.en,
      blocked: "dose",
    });
    expect(filter.sentence("Внесіть 2 кг/га після сходів.", "uk")).toEqual({
      text: TREATMENT_TEXT.uk,
      blocked: "dose",
    });
    expect(filter.sentence("Use 8 oz per acre.", "en").blocked).toBe("dose");
  });
  it("replaces product and active-ingredient names", () => {
    expect(filter.sentence("A glyphosate burndown kills volunteer.", "en").blocked).toBe("product");
    expect(filter.sentence("Гліфосат знищить падалицю.", "uk").blocked).toBe("product");
  });
  it("lets ordinary agronomy through", () => {
    expect(
      filter.sentence("Destroy volunteer wheat 2 weeks before sowing; 284 mm fell.", "en").blocked,
    ).toBeNull();
  });
  it("refuses product, chemical-price and legal questions", () => {
    expect(classifyRefusal("Which insecticide is best for rootworm?")).toBe("product");
    expect(classifyRefusal("Яку норму гербіциду внести?")).toBe("product");
    expect(classifyRefusal("How much does a fungicide spray cost?")).toBe("chemical_price");
    expect(classifyRefusal("Can I sue my neighbour over drift?")).toBe("legal");
    expect(classifyRefusal("Why is the rootworm risk high on F1?")).toBeNull();
  });
  it("rewrites a 10-year rotation horizon to 5 seasons", () => {
    expect(fixHorizon("Over 10 years this rotation pays off.", "en")).toEqual({
      text: "Over 5 seasons (2026–2030) this rotation pays off.",
      changed: true,
    });
    expect(fixHorizon("За 10 років ця сівозміна окупиться.", "uk").changed).toBe(true);
    expect(fixHorizon("The field has 10 years of drought records.", "en").changed).toBe(false);
  });
});

describe("tool schemas", () => {
  it("generate Gemini declarations and validate arguments", () => {
    const d = functionDeclarations();
    expect(d.map((x) => x.name)).toContain("get_field_history");
    expect(parseArgs("get_field_summary", { field: "F3" }).ok).toBe(true);
    expect(parseArgs("get_field_summary", { field: "Pivot 12" }).ok).toBe(false);
  });
});

describe("number words beyond twenty and source names", () => {
  it("combines tens and hundreds", () => {
    const v = (s: string, lang: Lang = "en") => extractNumbers(s, lang).map((e) => e.value);
    expect(v("twenty-five days")).toEqual([25]);
    expect(v("two hundred and ten mm")).toEqual([210]);
    expect(v("one hundred")).toEqual([100]);
    expect(v("thirty, five")).toEqual([30, 5]);
    expect(v("двадцять п'ять днів", "uk")).toEqual([25]);
    expect(v("двісті десять мм", "uk")).toEqual([210]);
    expect(v("сто двадцять", "uk")).toEqual([120]);
  });
  it("lets spelled-out numbers through when a tool result has them", () => {
    const a = new AllowedSet();
    a.addResult({ days: 25, mm: 210 });
    expect(checkSentence("It rained twenty-five days.", a, "en").ok).toBe(true);
    expect(checkSentence("Випало двісті десять мм.", a, "uk").ok).toBe(true);
    expect(checkSentence("Випало двісті мм.", a, "uk").ok).toBe(false);
  });
  it("only hides digits of known identifiers", () => {
    const a = new AllowedSet();
    expect(checkSentence("FAO-56, SCS-CN and USDA CDL are the methods.", a, "en").ok).toBe(true);
    expect(checkSentence("FAO-33 gives the yield response.", a, "en").ok).toBe(true);
    expect(checkSentence("NASA POWER weather and Sentinel-2 imagery.", a, "en").ok).toBe(true);
    expect(checkSentence("NASA 2025 reports it.", a, "en").ok).toBe(false);
  });
});
