import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyRefusal, createSafetyFilter, parseActives, type RefusalKind } from "./safety.js";

const actives = parseActives(
  readFileSync(new URL("../../../data/safety/actives.txt", import.meta.url), "utf8"),
);
const filter = createSafetyFilter(actives);
const blocked = (s: string, lang: "en" | "uk" = "en") => filter.sentence(s, lang).blocked;

describe("doses (table-driven, EN and UK)", () => {
  const doses: Array<[string, "en" | "uk"]> = [
    ["Apply 1.5 l/ha at the first sign.", "en"],
    ["Use 8 oz per acre.", "en"],
    ["Spray 2 litres per hectare in the morning.", "en"],
    ["Spray 2 liters per hectare in the morning.", "en"],
    ["Use 1.5 to 2 litres of product per hectare.", "en"],
    ["Apply two litres per hectare.", "en"],
    ["Apply 12 ounces per acre.", "en"],
    ["About 300 grams per acre is enough.", "en"],
    ["Mix 50 ml per 10 litres of water.", "en"],
    ["Use 50 mL / 10 L of water.", "en"],
    ["Rate: 0.5 lb a.i./acre.", "en"],
    ["Use 3 pints per acre.", "en"],
    ["Apply 5 gallons per acre.", "en"],
    ["Apply 2\nlitres per hectare.", "en"],
    ["The label says 250 g/l concentrate.", "en"],
    ["Внесіть 2 кг/га після сходів.", "uk"],
    ["Норма 1,5 літрів на гектар.", "uk"],
    ["Норма 1,5 л на гектар.", "uk"],
    ["Використайте 200 грамів на гектар.", "uk"],
    ["Використайте 300 г на гектар.", "uk"],
    ["Додайте 50 мл на 10 л води.", "uk"],
    ["Додайте 50 мл на 10 літрів води.", "uk"],
    ["Витрата 250 г/л діючої речовини.", "uk"],
    ["Витрата два літри на гектар.", "uk"],
    ["Витрата 2 літри препарату на гектар.", "uk"],
    ["Внесіть 8 унцій на акр.", "uk"],
    ["Внесіть 200 г/сотку.", "uk"],
    ["Внесіть 2 л/га і не більше.", "uk"],
  ];
  it.each(doses)("blocks %s", (s, lang) => {
    expect(blocked(s, lang)).toBe("dose");
  });
});

describe("product names and active ingredients, with inflections", () => {
  const names: Array<[string, "en" | "uk"]> = [
    ["A glyphosate burndown kills volunteer.", "en"],
    ["Glyphosates are widely used.", "en"],
    ["Tank mix with Atrazine.", "en"],
    ["Try Roundup before sowing.", "en"],
    ["Use Enlist soybeans.", "en"],
    ["Gly­phosate works.", "en"],
    ["Dual-Magnum is common.", "en"],
    ["Dual  Magnum is common.", "en"],
    ["Use glyphоsate here.", "en"], // Cyrillic о
    ["Гліфосат знищить падалицю.", "uk"],
    ["Обробіть гліфосатом перед сівбою.", "uk"],
    ["Після гліфосату зачекайте.", "uk"],
    ["Баки з тебуконазолом дають ефект.", "uk"],
    ["Раундапом можна обробити.", "uk"],
    ["Скористайтеся Ураган Форте.", "uk"],
    ["Імідаклопридом протруюють насіння.", "uk"],
    ["Фунгіцид Амістар Екстра захистить.", "uk"],
  ];
  it.each(names)("blocks %s", (s, lang) => {
    expect(blocked(s, lang)).toBe("product");
  });
});

describe("ordinary agronomy passes", () => {
  const ok: Array<[string, "en" | "uk"]> = [
    ["Destroy volunteer wheat 2 weeks before sowing; 284 mm fell.", "en"],
    ["Expect 5 t/ha with 120 mm of irrigation.", "en"],
    ["Rainfall was 12 mm per day for three days.", "en"],
    ["Wind 7 m/s, scout the field within 3 days.", "en"],
    ["Ризик високий: 3 дні поспіль понад 85 % вологості.", "uk"],
    ["Урожайність 5 т/га, зрошення 120 мм.", "uk"],
    ["Огляньте поле через 10 днів; опадів 12 мм на добу.", "uk"],
    ["Statuses and impacts were reviewed.", "en"],
  ];
  it.each(ok)("passes %s", (s, lang) => {
    expect(blocked(s, lang)).toBeNull();
  });
});

describe("refusals, across newlines and phrasings", () => {
  const cases: Array<[string, RefusalKind | null]> = [
    ["Which insecticide is best for rootworm?", "product"],
    ["Which\ninsecticide\nis best for rootworm?", "product"],
    ["What should I spray on my corn for aphids?", "product"],
    ["What do I need to spray for rust?", "product"],
    ["Give me the application rate for my fungicide", "product"],
    ["What dose per hectare of herbicide?", "product"],
    ["Recommend a tank mix for wheat", "product"],
    ["What dosage per acre should I use?", "product"],
    ["Яку норму гербіциду внести?", "product"],
    ["Який препарат\nкраще використати проти попелиці?", "product"],
    ["Порадьте фунгіцид для пшениці", "product"],
    ["Чим обробити пшеницю від іржі?", "product"],
    ["Яка норма внесення?", "product"],
    ["Яка бакова суміш підійде?", "product"],
    ["How much does a fungicide spray cost?", "chemical_price"],
    ["What is the price of\nherbicide?", "chemical_price"],
    ["Скільки коштує фунгіцид?", "chemical_price"],
    ["Яка ціна\nгербіциду?", "chemical_price"],
    ["Can I sue my neighbour over drift?", "legal"],
    ["Why is the rootworm risk high on F1?", null],
    ["Чому ризик іржі високий на полі F1?", null],
    ["When should I scout field F3?", null],
  ];
  it.each(cases)("%s", (q, kind) => {
    expect(classifyRefusal(q)).toBe(kind);
  });
});
