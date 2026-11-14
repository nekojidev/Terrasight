/** Evaluator inputs and outputs (RFC §10.3, Tech Design §10.1). Everything is plain data: no I/O. */

export type Level = "none" | "low" | "moderate" | "high" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low";
export type Tier = "A" | "B" | "C";
export type ValueSource = "confirmed" | "plan" | "estimate" | "regional" | "unknown";

export interface DailyWeather {
  /** ISO date. */
  date: string;
  tminC: number | null;
  tmaxC: number | null;
  tmeanC: number | null;
  precipMm: number | null;
  /** Surface / shallow soil temperature, °C, when the source has it. */
  soilC?: number | null;
  /** NASA POWER history, Open-Meteo recent observed days, or forecast. */
  origin: "power" | "observed" | "forecast";
  /** 1-based forecast day for `forecast` rows. */
  forecastDay?: number;
}

export interface CropSeasonInput {
  season: number;
  mainCrop: string;
  secondCrop: string | null;
  confidence: number;
  source: string;
  isOverride: boolean;
}

export interface EvalInputs {
  fieldId: string;
  tier: Tier;
  regionId: string | null;
  /** Current season (harvest year) the field is in. */
  season: number;
  /** Past seasons, any order. */
  crops: CropSeasonInput[];
  /** Crop for the next season from the saved plan or the recommended option, if any. */
  nextCrop: { season: number; crop: string | null; source: "plan" | "recommended" | "unknown" };
  /** This season's record (RFC §6.4). */
  record: {
    crop: { value: string | null; source: ValueSource };
    sowingDate: { value: string | null; source: ValueSource };
    emergenceDate: { value: string | null; source: ValueSource };
  };
  /** Daily weather: POWER history (1981+), recent observed days and the forecast, in date order. */
  weather: DailyWeather[];
  /** Field NDVI observations (Sentinel-2, 10 m), date order. */
  ndvi: Array<{ date: string; mean: number }>;
  /** Default planning deadline (typical sowing date of the next crop in the region). */
  planningDeadline: string | null;
  /** Pests already scouted on this field this season (lifts the medium cap, RFC §10.3). */
  scouted: string[];
  southernHemisphere?: boolean;
}

export interface KeyNumber {
  id: string;
  value: number | string;
  unit?: string;
  weight: number;
}

export interface Evidence {
  source: string;
  from?: string;
  to?: string;
  value?: number | string;
  unit?: string;
  note?: string;
}

export interface Citation {
  threshold: string;
  value: number;
  unit: string;
  title: string | null;
  publisher: string | null;
  url: string | null;
  accessed: string | null;
}

/** One node's result inside the tree. */
export interface NodeResult {
  level: Level;
  numbers: Record<string, { value: number | string; unit?: string }>;
  drivers: Array<{ driver: string; value: number | string; unit?: string; fired: boolean }>;
  evidence: Evidence[];
  unknowns: string[];
  /** Key inputs that were estimated (each costs one confidence step). */
  estimated: string[];
  /** Latest forecast day the result relied on. */
  forecastDayUsed?: number;
}

export interface RiskResult {
  pest: string;
  level: Level;
  deadline: string | null;
  irreversible: boolean;
  planning: boolean;
  keyNumbers: KeyNumber[];
  drivers: NodeResult["drivers"];
  evidence: Evidence[];
  citations: Citation[];
  unknowns: string[];
  confidence: ConfidenceLevel;
  tier: Tier;
}
