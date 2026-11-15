import type { Library } from "@terrasight/library";
import { type EngineInput } from "@terrasight/scenario-engine";

import type { InputMeta } from "./scenario-inputs.service.js";

/** Nothing is simulated: the agronomist sees what is missing (prices awaiting verification, or the last crops). */
export function pendingView(
  lib: Library,
  reason: "prices" | "crop-history" | "crops",
  input: EngineInput,
  meta: InputMeta,
  missingPrices: string[],
  unmodelled: string[] = [],
) {
  const regionId = lib.rotations.rotations.find((x) => x.id === input.rotations[0]?.id)?.region ?? null;
  const regionPrices = regionId ? (lib.prices.regions[regionId]?.crops ?? {}) : {};
  const unverified = Object.entries(regionPrices)
    .filter(([, e]) => !e.verified)
    .map(([c]) => c);
  return {
    id: null,
    noLibrary: false as const,
    pending: reason,
    firstSeason: input.firstSeason,
    regionId,
    regionVerify: regionId ? (lib.rotations.regions[regionId]?.verify ?? false) : false,
    missingPrices,
    unverifiedPrices: unverified,
    unmodelledCrops: unmodelled,
    priceAsOf: [...new Set(Object.values(regionPrices).map((p) => p.asOf))].join(", "),
    currentBasis: meta.currentBasis,
    currentSequence: meta.currentSequence,
    lastSeason: meta.lastSeason,
    soilBasis: meta.soilBasis,
    cropNames: Object.fromEntries(
      Object.entries(lib.rotations.crops).map(([id, c]) => [id, { en: c.en, uk: c.uk }]),
    ),
    candidates: input.rotations.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      name: (
        lib.rotations.rotations.find((x) => x.id === r.id) as unknown as
          { name: { en: string; uk: string } } | undefined
      )?.name ?? { en: r.id, uk: r.id },
    })),
  };
}
