import { clsx } from "clsx";

export interface BigNumberProps {
  /** Already formatted for the workspace units and UI language. */
  value: string;
  label: string;
  /** Driver weight 0–1, shown as a bar under the number. */
  weight: number;
  className?: string;
}

/** Mono value + label + weight bar (design/README §3); up to 3 per hero or field brief. */
export function BigNumber({ value, label, weight, className }: BigNumberProps) {
  const w = Math.max(0, Math.min(1, weight));
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1 border-t-2 border-ink pt-3", className)}>
      <span className="text-big-number text-ink">{value}</span>
      <span className="text-small text-ink-2">{label}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(w * 100)}
        className="mt-2 block h-1 w-full overflow-hidden rounded-chip bg-muted"
      >
        <span
          className="block h-full origin-left bg-ink transition-transform duration-bar ease-ts"
          style={{ transform: `scaleX(${w})` }}
        />
      </span>
    </div>
  );
}
