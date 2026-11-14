import { z } from "zod";

/** A field as the model sees it: its alias, never its name (RFC §12.6). */
const FieldRef = z
  .string()
  .regex(/^F\d+$/)
  .describe("Field alias such as F3");
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("ISO date yyyy-mm-dd");

/**
 * Read-only assistant tools (RFC §12.3). The executor takes workspace, role and field scope from the session, never
 * from these arguments. `run_rotation_scenarios` joins with the scenario engine (EP-06).
 */
export const TOOLS = {
  list_fields: {
    description:
      "List the company's fields: alias, region, data tier, current crop and the number of open items by urgency.",
    args: z.object({
      urgency: z
        .enum(["urgent", "this_week", "all_good"])
        .optional()
        .describe("Only fields whose top item has this urgency"),
    }),
  },
  get_brief: {
    description:
      "Today's morning brief: counts, the 'Start here' item, This week items, All good fields and the last analysis run. Use it to summarise the day.",
    args: z.object({}),
  },
  get_field_summary: {
    description:
      "One field: area, region, data tier, irrigation (and whether it was confirmed), slope and this season's record (crop, sowing and emergence dates with their source).",
    args: z.object({ field: FieldRef }),
  },
  get_field_history: {
    description:
      "One field's crop per season (with source and confidence), stress years with reasons, and seasonal stats (precipitation, heat days, NDVI peak).",
    args: z.object({
      field: FieldRef,
      fromSeason: z.number().int().min(2008).max(2030).optional(),
      toSeason: z.number().int().min(2008).max(2030).optional(),
    }),
  },
  get_weather: {
    description:
      "Observed daily weather for a field between two dates: total precipitation, mean / min / max temperature, frost days, and the percentile of the mean temperature and precipitation against the same window in every year since 1981.",
    args: z.object({ field: FieldRef, from: IsoDate, to: IsoDate }),
  },
  get_forecast: {
    description:
      "Daily forecast for a field (up to 10 days; days 8–10 are uncertain) with the provider and issue time.",
    args: z.object({ field: FieldRef, days: z.number().int().min(1).max(10).default(7) }),
  },
  list_recommendations: {
    description:
      "Open recommendations: id, field alias, pest or type, level, confidence, deadline, urgency and status.",
    args: z.object({
      field: FieldRef.optional(),
      status: z.enum(["open", "accepted", "snoozed", "in_report"]).optional(),
    }),
  },
  explain_recommendation: {
    description:
      "Why a recommendation fired: drivers, key numbers, evidence with sources and dates, model thresholds with citations, what is unknown, scouting text.",
    args: z.object({ id: z.string().uuid() }),
  },
  run_risk_model: {
    description:
      "What-if for one pest model on a field without saving anything, e.g. sowing on another date. Returns the risk with and without the change.",
    args: z.object({
      field: FieldRef,
      pest: z.string().describe("Pest id, e.g. barley_yellow_dwarf"),
      sowingDate: IsoDate.optional().describe("Alternative sowing date"),
      nextCrop: z.string().optional().describe("Alternative crop for next season, e.g. alfalfa"),
    }),
  },
  compare: {
    description:
      "Differences between two numbers or two results so you never subtract yourself: returns a − b, b − a and the percent change.",
    args: z.object({
      a: z.number(),
      b: z.number(),
      unit: z.string().optional(),
      label: z.string().optional(),
    }),
  },
  get_pest_info: {
    description:
      "Library entry for a pest or disease in the user's language: crops, season, damage, risk factors, how to scout and prevention (never products or doses).",
    args: z.object({ pest: z.string() }),
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolArgs<N extends ToolName> = z.infer<(typeof TOOLS)[N]["args"]>;

/** Gemini function declarations generated from the zod schemas (S-05.01). */
export function functionDeclarations(): Array<{
  name: string;
  description: string;
  parametersJsonSchema: unknown;
}> {
  return (Object.entries(TOOLS) as Array<[ToolName, (typeof TOOLS)[ToolName]]>).map(([name, t]) => {
    const schema = z.toJSONSchema(t.args, { target: "draft-2020-12", io: "input" }) as Record<
      string,
      unknown
    >;
    delete schema.$schema;
    return { name, description: t.description, parametersJsonSchema: schema };
  });
}

/** Validates model-supplied arguments; invalid arguments become a tool error the model can read. */
export function parseArgs<N extends ToolName>(
  name: N,
  args: unknown,
): { ok: true; args: ToolArgs<N> } | { ok: false; error: string } {
  const r = TOOLS[name].args.safeParse(args ?? {});
  return r.success
    ? { ok: true, args: r.data as ToolArgs<N> }
    : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

export const isTool = (name: string): name is ToolName => name in TOOLS;

/** Progress line shown while a tool runs ("Reading 2022 weather…"). */
export function progressText(name: ToolName, args: Record<string, unknown>, lang: "en" | "uk"): string {
  const f = typeof args.field === "string" ? ` ${args.field}` : "";
  const en: Record<ToolName, string> = {
    list_fields: "Listing fields…",
    get_brief: "Reading today's brief…",
    get_field_summary: `Reading field${f}…`,
    get_field_history: `Reading the crop history of${f}…`,
    get_weather: `Reading weather for${f}${args.from ? ` from ${String(args.from)}` : ""}…`,
    get_forecast: `Reading the forecast for${f}…`,
    list_recommendations: "Reading recommendations…",
    explain_recommendation: "Reading why the recommendation fired…",
    run_risk_model: `Running the risk model for${f}…`,
    compare: "Comparing the numbers…",
    get_pest_info: "Reading the pest library…",
  };
  const uk: Record<ToolName, string> = {
    list_fields: "Переглядаю поля…",
    get_brief: "Читаю сьогоднішній бриф…",
    get_field_summary: `Читаю дані поля${f}…`,
    get_field_history: `Читаю історію культур${f}…`,
    get_weather: `Читаю погоду для${f}${args.from ? ` з ${String(args.from)}` : ""}…`,
    get_forecast: `Читаю прогноз для${f}…`,
    list_recommendations: "Читаю рекомендації…",
    explain_recommendation: "Читаю, чому спрацювала рекомендація…",
    run_risk_model: `Запускаю модель ризику для${f}…`,
    compare: "Порівнюю числа…",
    get_pest_info: "Читаю бібліотеку шкідників…",
  };
  return (lang === "uk" ? uk : en)[name];
}

/** System rules (RFC §12.5). */
export function systemPrompt(lang: "en" | "uk", today: string): string {
  return [
    `You are the Terrasight assistant for agronomists. Today is ${today}. Answer in ${lang === "uk" ? "Ukrainian" : "English"}.`,
    "Every number you write must come from a tool result in this conversation, copied exactly (you may round as shown). Never calculate: use the compare tool for differences, sums and percentages. Write quantities as digits.",
    "Fields are called by aliases like F3. Use the alias exactly; never invent field names.",
    "Talk about risk, never diagnosis. Pest and disease answers end with 'scout to confirm' and how to scout.",
    "Never name crop-protection products, active ingredients or doses, and give no legal advice.",
    "Say when data is estimated or missing. The rotation horizon is always 5 seasons (2026–2030), never 10 years.",
    "Keep answers short: 2–5 sentences, plain words.",
  ].join("\n");
}
