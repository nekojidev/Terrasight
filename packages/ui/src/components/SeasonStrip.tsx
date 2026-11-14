import { clsx } from "clsx";

/** Crop colour roles from design/tokens.css. Crops without their own colour use the closest group. */
const CROP_VAR: Record<string, string> = {
  corn: "var(--crop-corn)",
  silage_corn: "var(--crop-corn)",
  winter_wheat: "var(--crop-wheat)",
  spring_wheat: "var(--crop-wheat)",
  durum_wheat: "var(--crop-wheat)",
  winter_barley: "var(--crop-wheat)",
  spring_barley: "var(--crop-wheat)",
  winter_rye: "var(--crop-wheat)",
  triticale: "var(--crop-wheat)",
  oat: "var(--crop-wheat)",
  millet: "var(--crop-wheat)",
  sorghum: "var(--crop-sorghum)",
  forage_sorghum: "var(--crop-sorghum)",
  soybean: "var(--crop-soy)",
  pea: "var(--crop-soy)",
  lentil: "var(--crop-soy)",
  chickpea: "var(--crop-soy)",
  faba_bean: "var(--crop-soy)",
  alfalfa: "var(--crop-alfalfa)",
  clover: "var(--crop-alfalfa)",
  clover_grass: "var(--crop-alfalfa)",
  fallow: "var(--crop-fallow)",
};

export function cropColour(crop: string): string {
  return CROP_VAR[crop] ?? "var(--ts-line-strong)";
}

export interface Season {
  crop: string;
  /** Localised crop name, used for the accessible label. */
  name: string;
  year: number;
}

/** 5 bars in crop colours — the Terrasight signature (design/README §3). */
export function SeasonStrip({
  seasons,
  label,
  size = "md",
  className,
}: {
  seasons: Season[];
  /** Optional visible label, e.g. "2022–26". */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const accessible = seasons.map((s) => `${s.year}: ${s.name}`).join(", ");
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <span role="img" aria-label={accessible} className="inline-flex items-end gap-0.5">
        {seasons.map((s) => (
          <span
            key={s.year}
            className={clsx("block rounded-[2px]", size === "sm" ? "h-3 w-1" : "h-5 w-1.5")}
            style={{ backgroundColor: cropColour(s.crop) }}
          />
        ))}
      </span>
      {label && <span className="font-mono text-[12px] text-ink-3">{label}</span>}
    </span>
  );
}
