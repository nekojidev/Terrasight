import { clsx } from "clsx";
import { cropColour } from "./SeasonStrip";

export interface FieldThumbProps {
  /** Localised field name, used as alt text. */
  name: string;
  /** Real field outline: SVG path data in a 0–100 box (API `thumb`). */
  outline?: string | null;
  /** Schematic fallback used only when no outline is given (stories). */
  shape?: "pivot" | "strip";
  /** Crop id; the outline is filled with its colour, or a neutral token when unknown. */
  crop?: string | null;
  /** Sentinel-2 true-colour thumbnail URL in production; without it a schematic tile is drawn. */
  src?: string;
  size?: 40 | 56 | 64;
  className?: string;
}

/** Satellite tile with the field's shape (design/README §3). */
export function FieldThumb({
  name,
  outline,
  shape,
  crop,
  src,
  size = 56,
  className,
}: FieldThumbProps) {
  const box = clsx("shrink-0 overflow-hidden rounded-btn", className);
  if (src) {
    return <img src={src} alt={name} width={size} height={size} className={clsx(box, "object-cover")} />;
  }
  const fill = crop ? cropColour(crop) : "var(--ts-line-strong)";
  if (outline || !shape) {
    return (
      <svg role="img" aria-label={name} width={size} height={size} viewBox="0 0 100 100" className={box}>
        <rect width="100" height="100" fill="var(--ts-muted)" />
        {outline && (
          <path
            d={outline}
            transform="translate(10 10) scale(0.8)"
            fill={fill}
            stroke="var(--ts-ink)"
            strokeOpacity="0.35"
            strokeWidth="2.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    );
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
          fill={fill}
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
          fill={fill}
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
