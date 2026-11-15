import { z } from "zod";

/** Localised text: every UI string in the library exists in Ukrainian and English. */
export const I18nText = z.object({ en: z.string().min(1), uk: z.string().min(1) });

// ---------- rotations.json (v2) ----------

export const CropId = z.string().regex(/^[a-z_]+$/);

export const Crop = z.object({ en: z.string().min(1), uk: z.string().min(1), family: z.string().min(1) });

const Bounds = z.tuple([z.number(), z.number()]).refine(([a, b]) => a < b, "bounds must be [min, max]");

export const MatchRule = z.object({
  admin: z.array(z.string().min(2)).min(1),
  lat: Bounds.optional(),
  lon: Bounds.optional(),
});

export const Region = z.object({
  en: z.string().min(1),
  uk: z.string().min(1),
  precipMm: Bounds,
  tier: z.enum(["A", "B", "C"]),
  hemisphere: z.enum(["N", "S"]),
  countries: z.array(z.string().length(2)).min(1),
  match: z.array(MatchRule).min(1),
  verify: z.boolean(),
});

export const SequenceItem = z.union([CropId, z.object({ main: CropId, second: CropId })]);

export const Rotation = z.object({
  id: z.string().min(1),
  region: z.string().min(1),
  name: I18nText,
  sequence: z.array(SequenceItem).min(1).max(6),
  cover: CropId.optional(),
  irrigation: z.enum(["required", "optional", "none"]),
  water: z.enum(["low", "medium", "high"]),
  baseline: z.boolean().optional(),
  goals: z.array(z.enum(["margin", "water", "soil", "drought"])).min(1),
  rationale: I18nText,
  risks: I18nText,
  minPrecipMm: z.number().positive().optional(),
  minSeasonDays: z.number().positive().optional(),
  maxSlopePct: z.number().positive().optional(),
});

export const RotationsFile = z.object({
  version: z.literal(2),
  notes: z.string(),
  crops: z.record(z.string(), Crop),
  regions: z.record(z.string(), Region),
  rotations: z.array(Rotation),
});

// ---------- pests.json ----------

export const Pest = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  name: I18nText,
  latin: z.string(),
  crops: z.array(CropId).min(1),
  regions: z.array(z.string()).min(1),
  season: I18nText,
  damage: I18nText,
  drivers: z.array(z.string()).min(1),
  riskWhen: I18nText,
  model: z.looseObject({ type: z.string(), verify: z.boolean() }),
  signals: z.array(z.string()).min(1),
  scout: I18nText,
  prevent: I18nText,
  note: I18nText.optional(),
});

export const PestsFile = z.object({
  version: z.number(),
  notes: z.string(),
  kinds: z.record(z.string(), I18nText),
  drivers: z.record(z.string(), I18nText),
  signals: z.record(z.string(), z.string()),
  pests: z.array(Pest),
});

// ---------- pest-models.json (Tech Design §6.1) ----------

export const ThresholdSource = z.object({
  title: z.string().nullable(),
  publisher: z.string().nullable(),
  url: z.string().nullable(),
  accessed: z.string().nullable(),
  appliesTo: z.array(z.string()).default([]),
  /**
   * `extension` = university extension (K-State, UNL, CSU); `fallback` = other agency or peer-reviewed source;
   * `calibration` = an internal remote-sensing calibration, not an agronomic threshold (RFC §11.3).
   */
  type: z.enum(["extension", "fallback", "calibration"]).default("extension"),
  /** Short verbatim quote containing the value. */
  quote: z.string().optional(),
  /** How the value is applied, other regions' sources, limits. */
  note: z.string().optional(),
});

export const Threshold = z.object({
  value: z.number().nullable(),
  unit: z.string().min(1),
  verified: z.boolean(),
  source: ThresholdSource.nullable(),
  verifiedBy: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  regional: z.record(z.string(), z.number()).optional(),
});

export const EVALUATOR_KINDS = [
  "host_repeat",
  "host_interval",
  "degree_days",
  "weather_window",
  "climate_anomaly",
  "water_stress",
  "green_bridge",
  "sowing_before",
] as const;

export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number];

export type ModelNode =
  | ({ kind: EvaluatorKind } & Record<string, unknown>)
  | { all: ModelNode[] }
  | { any: ModelNode[] }
  | { max: ModelNode[] }
  | { gate: [ModelNode, ModelNode] };

export const ModelNode: z.ZodType<ModelNode> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ModelNode).min(1) }),
    z.object({ any: z.array(ModelNode).min(1) }),
    z.object({ max: z.array(ModelNode).min(1) }),
    z.object({ gate: z.tuple([ModelNode, ModelNode]) }),
    z.object({ kind: z.enum(EVALUATOR_KINDS) }).catchall(z.unknown()),
  ]),
) as z.ZodType<ModelNode>;

export const PestModel = z.object({
  pest: z.string().min(1),
  enabled: z.boolean(),
  phase: z.enum(["hackathon", "later"]),
  irreversible: z.boolean(),
  planning: z.boolean(),
  stageWindow: z.object({ crop: CropId, from: z.string(), to: z.string() }).nullable(),
  tree: ModelNode,
  thresholds: z.record(z.string(), Threshold),
  keyNumbers: z.array(z.string()).max(3),
  scoutAction: Threshold.nullable(),
});

export const PestModelsFile = z.object({
  version: z.number(),
  about: z.string().optional(),
  models: z.array(PestModel),
});

// ---------- prices.json (Tech Design §6.2) ----------

const Amount = z.object({ value: z.number().nullable(), unit: z.string().min(1) });

export const CropPrice = z.object({
  price: Amount,
  /** Irrigated budget (or the only one); null when no irrigated budget exists. */
  variableCost: Amount,
  yieldRef: Amount,
  /** Dryland budget, when it differs (RFC §16). */
  dryland: z.object({ variableCost: Amount, yieldRef: Amount }).optional(),
  source: z.string().min(1),
  asOf: z.string().min(4),
  urls: z.array(z.string()).default([]),
  note: z.string().optional(),
  /** Reviewed by the team (like pest thresholds); scenarios use only verified prices. */
  verified: z.boolean().default(false),
  verifiedBy: z.string().nullable().default(null),
});

/** Irrigation pumping cost per mm (energy and labour), used only when verified. */
export const IrrigationCost = z.object({
  /** $ per ha per mm applied; null until a source is found. */
  value: z.number().nullable(),
  unit: z.string().min(1),
  source: z.string().min(1),
  asOf: z.string().min(4).nullable().default(null),
  urls: z.array(z.string()).default([]),
  note: z.string().optional(),
  verified: z.boolean().default(false),
  verifiedBy: z.string().nullable().default(null),
});

export const PricesFile = z.object({
  version: z.number(),
  about: z.string().optional(),
  currency: z.string().length(3),
  irrigationCostPerMm: IrrigationCost.optional(),
  regions: z.record(z.string(), z.object({ crops: z.record(z.string(), CropPrice) })),
  fallback: z.object({
    source: z.string(),
    label: z.string(),
    byCountry: z.record(z.string(), z.record(z.string(), Amount)),
  }),
});

export type RotationsFile = z.infer<typeof RotationsFile>;
export type Region = z.infer<typeof Region>;
export type Rotation = z.infer<typeof Rotation>;
export type SequenceItem = z.infer<typeof SequenceItem>;
export type PestsFile = z.infer<typeof PestsFile>;
export type Pest = z.infer<typeof Pest>;
export type PestModelsFile = z.infer<typeof PestModelsFile>;
export type PestModel = z.infer<typeof PestModel>;
export type Threshold = z.infer<typeof Threshold>;
export type PricesFile = z.infer<typeof PricesFile>;
