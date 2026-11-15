/**
 * "What NASA data contributed here" (EP-10, S-10.12): which dataset each conclusion rests on, built from the data that
 * was actually used for this recommendation or rotation run, never from a fixed string.
 */

export type DataAgency = "NASA" | "USDA" | "ESA" | "other";

export interface DataBasisItem {
  /** "NASA POWER", "MODIS NDVI (MOD13Q1)", "GPM IMERG", "USDA Cropland Data Layer", "USDA SSURGO", … */
  dataset: string;
  agency: DataAgency;
  /** Period used (ISO dates); null when not applicable. */
  from: string | null;
  to: string | null;
  /** Last day or last image that entered the result. */
  lastDate: string | null;
  /**
   * Conclusions this dataset supports, as ids for copy:
   * "weather-years" | "stress-2022" | "climate-shift" | "degree-days" | "crop-history" | "stress-years" |
   * "soil-water" | "forecast" | "green-bridge" | "rain-check" | "crop-estimate".
   */
  supports: string[];
}
