import { clsx } from "clsx";
import { cropColour } from "./SeasonStrip";

export interface FieldThumbProps {
  /** Localised field name, used as alt text. */
  name: string;
  shape?: "pivot" | "strip";
  crop?: string;
  /** Sentinel-2 true-colour thumbnail URL in production; without it a schematic tile is drawn. */
  src?: string;
  size?: 40 | 56 | 64;
  className?: string;
}

/** Satellite tile with the field's shape (design/README §3). */
export function FieldThumb({
  name,
  shape = "pivot",
  crop = "fallow",
  src,
  size = 56,
  className,
}: FieldThumbProps) {
  const box = clsx("shrink-0 overflow-hidden rounded-btn", className);
  if (src) {
    return <img src={src} alt={name} width={size} height={size} className={clsx(box, "object-cover")} />;
  }
  return (
    <svg role="img" aria-label={name} width={size} height={size} viewBox="0 0 56 56" className={box}>
      <rect width="56" height="56" fill="var(--ts-muted)" />
      <rect width="56" height="56" fill="var(--crop-fallow)" opacity="0.35" />
      {shape === "pivot" ? (
        <circle
          cx="28"
          cy="28"
          r="22"
          fill={cropColour(crop)}
          stroke="var(--ts-ink)"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
      ) : (
        <rect
          x="6"
          y="18"
          width="44"
          height="20"
          rx="3"
          fill={cropColour(crop)}
          stroke="var(--ts-ink)"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
      )}
      {shape === "pivot" && (
        <line x1="28" y1="28" x2="44" y2="20" stroke="var(--ts-surface)" strokeWidth="1.7" />
      )}
    </svg>
  );
}
