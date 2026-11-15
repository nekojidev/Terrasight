"use client";

import { useTranslations } from "next-intl";

/**
 * Plain-language notes for the engine's caveat codes ("unverified-crop-parameters:<crop>", "irrigation-cost-in-budget",
 * "repeat-penalty-not-modelled:<crop>"). `only` limits the notes to some kinds.
 */
export function CaveatNotes({
  caveats,
  cropName,
  only,
  className = "mt-2",
}: {
  caveats: string[] | undefined;
  cropName: (id: string) => string;
  only?: Array<"crop" | "water" | "repeat">;
  className?: string;
}) {
  const t = useTranslations("App");
  const notes: string[] = [];
  for (const c of caveats ?? []) {
    const [code, crop = ""] = c.split(":");
    if (code === "unverified-crop-parameters" && (!only || only.includes("crop")))
      notes.push(t("rotCavCrop", { crop: cropName(crop) }));
    else if (code === "irrigation-cost-in-budget" && (!only || only.includes("water"))) notes.push(t("rotCavWater"));
    else if (code === "repeat-penalty-not-modelled" && (!only || only.includes("repeat")))
      notes.push(t("rotCavRepeat", { crop: cropName(crop) }));
  }
  if (!notes.length) return null;
  return (
    <ul role="note" className={`${className} flex flex-col gap-1 text-small text-ink-2`} data-testid="caveat-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
