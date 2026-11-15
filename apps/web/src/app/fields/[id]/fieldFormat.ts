import type { UseFormatOptions } from "@/lib/useFormat";

/** Units follow the field's country (US: imperial); when the country is unknown the workspace unit setting is used. */
export function fieldFormatOptions(
  country: string | null | undefined,
  units: "metric" | "imperial",
): UseFormatOptions {
  return country ? { country } : { units };
}
