import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import appEn from "./app.en.json";
import appUk from "./app.uk.json";

const tr = (locale: "en" | "uk") =>
  createTranslator({
    locale,
    messages: { App: locale === "en" ? appEn.App : appUk.App },
    onError: () => undefined,
  } as never) as unknown as (key: string, values?: Record<string, number>) => string;

describe("plural message keys", () => {
  it("English days and seasons agree with the number", () => {
    const t = tr("en");
    expect(t("App.thr_unit_days", { n: 1 })).toBe("1 day");
    expect(t("App.thr_unit_days", { n: 3 })).toBe("3 days");
    expect(t("App.thr_unit_seasons", { n: 1 })).toBe("1 season");
    expect(t("App.thr_unit_seasons", { n: 2 })).toBe("2 seasons");
  });
  it("Ukrainian uses one / few / many", () => {
    const t = tr("uk");
    expect(t("App.thr_unit_days", { n: 1 })).toBe("1 день");
    expect(t("App.thr_unit_days", { n: 2 })).toBe("2 дні");
    expect(t("App.thr_unit_days", { n: 5 })).toBe("5 днів");
    expect(t("App.thr_unit_seasons", { n: 1 })).toBe("1 сезон");
    expect(t("App.thr_unit_seasons", { n: 3 })).toBe("3 сезони");
    expect(t("App.thr_unit_seasons", { n: 11 })).toBe("11 сезонів");
  });
});

describe("data tier names", () => {
  it("are exactly Full data / Basic data / Estimate (and the Ukrainian pair) in every namespace", () => {
    const want = {
      en: ["Full data", "Basic data", "Estimate"],
      uk: ["Повні дані", "Базові дані", "Оцінка"],
    };
    for (const [lang, all] of [["en", en], ["uk", uk]] as const) {
      for (const [ns, msgs] of Object.entries(all as Record<string, Record<string, unknown>>)) {
        const got = ["tier_A", "tier_B", "tier_C"].map((k) => msgs[k]);
        if (got.every((g) => g === undefined)) continue;
        expect([ns, got]).toEqual([ns, want[lang]]);
      }
    }
  });
});
