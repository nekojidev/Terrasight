import type { Library } from "@terrasight/library";

export type Lang = "en" | "uk";
export type Localised = Record<Lang, string>;

/** What a card, the report and the assistant say about a recommendation (RFC §9 risk-card template, §11.5). */
export interface RecText {
  title: Localised;
  action: Localised;
  why: Localised;
  /** Pest and disease cards end with this (RFC §11.5). */
  scout: Localised | null;
  /** Who wrote title / action / why: the assistant (number-checked) or the template below (the fallback). */
  source?: "ai" | "template";
}

interface RecLike {
  type: string;
  subject: string;
  season: number;
  level: string;
  planning: boolean;
  keyNumbers: unknown;
  drivers: unknown;
}

const LEVEL: Record<string, Localised> = {
  high: { en: "high risk", uk: "високий ризик" },
  moderate: { en: "moderate risk", uk: "середній ризик" },
  low: { en: "low risk", uk: "низький ризик" },
  none: { en: "no risk", uk: "ризику немає" },
  unknown: { en: "risk unknown — data missing", uk: "ризик невідомий — бракує даних" },
};

/** "2026-09-05" → "September 5, 2026" / "5 вересня 2026 р."; other values unchanged. */
export function value(v: number | string, lang: Lang): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${v}T12:00:00Z`));
  return String(v);
}

const DRIVER: Record<string, Localised> = {
  early_sowing: {
    en: "sown on {v}, earlier than the recommended date",
    uk: "посіяно {v}, раніше за рекомендовану дату",
  },
  rotation: { en: "host crop {v} season(s) in a row", uk: "культура-господар {v} сезон(и) поспіль" },
  degree_days: { en: "{v} °C·d since emergence", uk: "{v} °C·д від сходів" },
  temperature: { en: "autumn warmer than {v}% of past years", uk: "осінь тепліша за {v}% минулих років" },
  green_bridge: {
    en: "green vegetation in {v} image(s) between harvest and sowing",
    uk: "зелена рослинність на {v} знімк(ах) між збиранням і сівбою",
  },
  previous_crop: { en: "previous crop: {v}", uk: "попередня культура: {v}" },
};

/**
 * Plain text for a pest or disease item, built only from the library (names, scouting and prevention text) and the
 * evaluator's drivers — never product names or doses (RFC §11.5).
 */
/** Rotation item (S-03.08): the best-fit option's first crop for the next season, from the scenario engine. */
function rotationText(rec: RecLike, lib: Library): RecText {
  const d = ((rec.drivers as Array<{ driver: string; value: unknown }>) ?? []).reduce<
    Record<string, unknown>
  >((acc, x) => ({ ...acc, [x.driver]: x.value }), {});
  const crop = String(d.first_crop ?? "");
  const cropName = (lib.rotations.crops[crop] as { en: string; uk: string } | undefined) ?? {
    en: crop,
    uk: crop,
  };
  const rotation = lib.rotations.rotations.find((r) => r.id === d.best_option) as unknown as
    { name: Localised } | undefined;
  const keep = d.best_option === "current";
  return {
    title: keep
      ? {
          en: `Rotation for ${rec.season}: keep the current rotation`,
          uk: `Сівозміна на ${rec.season}: залишити поточну`,
        }
      : {
          en: `Rotation for ${rec.season}: ${cropName.en.toLowerCase()} first`,
          uk: `Сівозміна на ${rec.season}: першою — ${cropName.uk.toLowerCase()}`,
        },
    action: keep
      ? {
          en: "The current rotation fits your priorities best over the 5 seasons. Compare the options before seed is ordered.",
          uk: "Поточна сівозміна найкраще відповідає пріоритетам на 5 сезонів. Порівняйте варіанти до замовлення насіння.",
        }
      : {
          en: `Consider "${rotation?.name.en ?? String(d.best_option)}" over the 5 seasons; compare the options and save your choice to the plan.`,
          uk: `Розгляньте «${rotation?.name.uk ?? String(d.best_option)}» на 5 сезонів; порівняйте варіанти й збережіть вибір у план.`,
        },
    why: {
      en: "Scenario engine: 150 weather paths and 10 price scenarios over 5 seasons.",
      uk: "Сценарний рушій: 150 погодних шляхів і 10 цінових сценаріїв на 5 сезонів.",
    },
    scout: null,
  };
}

const numbers = (rec: RecLike) =>
  ((rec.keyNumbers as Array<{ id: string; value: number | string }>) ?? []).reduce<
    Record<string, number | string>
  >((acc, k) => ({ ...acc, [k.id]: k.value }), {});

/**
 * Weather and irrigation items (L-13): a frost forecast (0 °C, no crop-specific damage claim) and FAO-56 root-zone
 * depletion against readily available water. Wording stays at "check"; never products or doses.
 */
function alertText(rec: RecLike): RecText {
  const n = numbers(rec);
  if (rec.subject === "frost_alert") {
    const date = (lang: Lang) => value(n.frostDate ?? "", lang);
    const min = n.frostMinC ?? "";
    return {
      title: { en: `Frost expected on ${date("en")}`, uk: `Очікується заморозок ${date("uk")}` },
      action: {
        en: "Frost forecast; check sensitive crops and the growth stage in the field.",
        uk: "Прогноз заморозку; перевірте чутливі культури та фазу розвитку на полі.",
      },
      why: {
        en: `Forecast daily minimum air temperature ${min} °C (frost = 0 °C or below).`,
        uk: `Прогнозована мінімальна температура повітря ${min} °C (заморозок = 0 °C і нижче).`,
      },
      scout: null,
    };
  }
  const days = n.daysToStress;
  const soon = days === 0 || days === "0";
  return {
    title: soon
      ? { en: "Irrigation needed now", uk: "Потрібен полив зараз" }
      : {
          en: `Irrigation needed within ${days} days`,
          uk: `Потрібен полив протягом ${days} дн.`,
        },
    action: {
      en: "Plan an irrigation round: soil water in the root zone is at or past the readily available level.",
      uk: "Заплануйте полив: вода в кореневій зоні досягла або перейшла рівень легкодоступної вологи.",
    },
    why: {
      en: `Root-zone depletion ${n.depletionMm} mm against readily available water ${n.rawMm} mm (total available ${n.tawMm} mm), FAO-56 water balance.`,
      uk: `Дефіцит води в кореневій зоні ${n.depletionMm} мм проти легкодоступної ${n.rawMm} мм (загалом доступної ${n.tawMm} мм), водний баланс FAO-56.`,
    },
    scout: null,
  };
}

/**
 * The question put to the Owner in plain words (design v6, Unit 9; open question 25: a template, no new AI text and no
 * new numbers). Built only from the item's own fields: the field name, what changes and the agronomist's name.
 */
export function ownerQuestionText(
  rec: Pick<RecLike, "type" | "subject" | "season" | "drivers">,
  lib: Library | null,
  fieldName: string,
  askerName: string,
  title: Localised,
): Localised {
  const who: Localised = {
    en: askerName || "Your agronomist",
    uk: askerName || "Ваш агроном",
  };
  if (rec.type === "rotation") {
    const d = ((rec.drivers as Array<{ driver: string; value: unknown }>) ?? []).reduce<Record<string, unknown>>(
      (acc, x) => ({ ...acc, [x.driver]: x.value }),
      {},
    );
    const years = `${rec.season}–${rec.season + 4}`;
    if (d.best_option === "current")
      return {
        en: `${who.en} asks: may we keep the current rotation on ${fieldName} for ${years}?`,
        uk: `${who.uk} питає: чи залишаємо поточну сівозміну на полі ${fieldName} на ${years}?`,
      };
    const found = lib?.rotations.rotations.find((r) => r.id === d.best_option) as unknown as
      | { name: Localised }
      | undefined;
    const name: Localised = found?.name ?? { en: String(d.best_option ?? ""), uk: String(d.best_option ?? "") };
    return {
      en: `${who.en} asks: may we change the rotation on ${fieldName} to “${name.en}” for ${years}?`,
      uk: `${who.uk} питає: чи змінюємо сівозміну на полі ${fieldName} на «${name.uk}» на ${years}?`,
    };
  }
  return {
    en: `${who.en} asks for your decision on ${fieldName}: ${title.en}`,
    uk: `${who.uk} просить вашого рішення щодо поля ${fieldName}: ${title.uk}`,
  };
}

export function recommendationText(rec: RecLike, lib: Library): RecText {
  if (rec.type === "rotation") return rotationText(rec, lib);
  if (rec.type === "weather" || rec.type === "irrigation") return alertText(rec);
  const pest = lib.pests.pests.find((p) => p.id === rec.subject);
  const name: Localised = pest
    ? { en: pest.name.en, uk: pest.name.uk }
    : { en: rec.subject, uk: rec.subject };
  const level = LEVEL[rec.level] ?? LEVEL.unknown!;
  const fired = (
    (rec.drivers as Array<{ driver: string; value: number | string; fired: boolean }>) ?? []
  ).filter((d) => d.fired);
  const why = (lang: Lang) =>
    fired.length
      ? fired
          .map((d) =>
            (
              DRIVER[d.driver]?.[lang] ??
              `${lib.pests.drivers[d.driver]?.[lang] ?? d.driver.replace(/_/g, " ")}: {v}`
            ).replace("{v}", value(d.value, lang)),
          )
          .join("; ")
      : lang === "en"
        ? "No driver has fired."
        : "Жоден чинник не спрацював.";
  const scout: Localised | null = pest ? { en: pest.scout.en, uk: pest.scout.uk } : null;
  const prevent: Localised | null = pest ? { en: pest.prevent.en, uk: pest.prevent.uk } : null;
  const action: Localised =
    rec.planning && prevent
      ? { en: `Plan for ${rec.season}: ${prevent.en}`, uk: `План на ${rec.season}: ${prevent.uk}` }
      : {
          en: `Scout to confirm. ${scout?.en ?? ""}`.trim(),
          uk: `Огляньте поле, щоб підтвердити. ${scout?.uk ?? ""}`.trim(),
        };
  return {
    title: { en: `${name.en}: ${level.en}`, uk: `${name.uk}: ${level.uk}` },
    action,
    why: { en: why("en"), uk: why("uk") },
    scout: rec.type === "pest" || rec.type === "disease" ? scout : null,
  };
}
