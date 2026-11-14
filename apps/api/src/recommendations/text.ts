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

const DRIVER: Record<string, Localised> = {
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
export function recommendationText(rec: RecLike, lib: Library): RecText {
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
          .map((d) => (DRIVER[d.driver]?.[lang] ?? `${d.driver}: {v}`).replace("{v}", String(d.value)))
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
