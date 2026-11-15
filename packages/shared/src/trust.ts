/**
 * "How far can you trust this" (EP-10, S-10.08 – S-10.10): the simulator run over past seasons with the real weather,
 * compared with what happened. Deviations year to year, as they are; no parameter is tuned to the result.
 *
 *   GET /api/w/:ws/fields/:id/trust   → TrustReport
 */

/** Why the model may have missed a year: only reasons that the data of that year shows. */
export type MissReason = "heat" | "frost" | "harvest-rain" | "unknown";

export interface TrustYear {
  /** Harvest year. */
  year: number;
  /** Crop grown that year (library id), null when unknown. */
  crop: string | null;
  /** Model: relative yield of that crop, percent deviation from its own mean over the compared years. */
  model: number | null;
  /** County yield, percent deviation from its linear trend. Null when the county has no value for the year. */
  county: number | null;
  /** Field MODIS NDVI peak, percent deviation from the field's mean. */
  ndvi: number | null;
  /** The published county yield in t/ha (context for the table). */
  countyYield: number | null;
  practice: "irrigated" | "non-irrigated" | "all" | null;
  /** |model − county| above 20 percentage points (county missing → false). */
  miss: boolean;
  reason: MissReason | null;
}

export interface TrustFit {
  /** Years with both values. */
  n: number;
  /** Pearson correlation; null when n < 5. */
  r: number | null;
  /** Mean absolute error in percentage points. */
  mae: number | null;
}

export interface Retrospective {
  /** Harvest years simulated with their real weather, e.g. 2018…2022. */
  seasons: number[];
  mode: "money" | "agronomy";
  currency: string | null;
  /** Margin per hectare per season (or relative yield, percent, in agronomy-only mode). */
  current: { id: string; bySeason: Array<number | null>; total: number | null };
  recommended: { id: string; bySeason: Array<number | null>; total: number | null };
  /** Always "today": no historical prices exist; this compares two simulations, not what the field earned. */
  priceBasis: "today";
}

export interface TrustReport {
  status: "pending" | "ready" | "unavailable";
  /** "history-missing" | "weather-missing" | "no-crop-parameters". */
  reason?: string;
  fieldId: string;
  years: TrustYear[];
  vsCounty: TrustFit | null;
  vsNdvi: TrustFit | null;
  actual: {
    /** "nass": USDA NASS county yields; "derzhstat": Ukrainian oblast yields (unverified context); "none". */
    kind: "nass" | "derzhstat" | "none";
    /** False when the source needs a key that is not configured. */
    connected: boolean;
    area: string | null;
    verified: boolean;
  };
  /** The 2022 season, when the field has it. */
  case2022: TrustYear | null;
  /** What the simulator leaves out, as ids for copy: "heat" | "frost" | "pests" | "nutrients" | "variety" | "harvest". */
  notModelled: string[];
  /** Engine caveats carried over, e.g. "unverified-crop-parameters:winter_wheat". */
  caveats: string[];
  retrospective: Retrospective | null;
  /**
   * True when the model shows no year-to-year change for this field (an irrigated field: the simulator assumes
   * irrigation always covers the crop's need, so its relative yield is 1 in every year). Then `vsCounty` and `vsNdvi`
   * have r = null and the page must say that the model cannot be checked against yields for this field.
   */
  modelFlat: boolean;
  /**
   * The same model, soil and weather WITHOUT irrigation, against non-irrigated yields (state level when the county
   * has too few). It checks what the simulator actually models (water stress); it is not this field's own result.
   * Null when the field is rainfed already (the main comparison is that check) or when no non-irrigated series exists.
   */
  dryland: {
    area: string;
    years: TrustYear[];
    fit: TrustFit | null;
    case2022: TrustYear | null;
  } | null;
}
