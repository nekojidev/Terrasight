import { clsx } from "clsx";
import { Chip } from "./Chip";

export interface Factor {
  label: string;
  /** Formatted value, e.g. "124 days". */
  value?: string;
  /** 0–1 */
  weight: number;
  /** Source stamp, e.g. "POWER · 2026-11-13". */
  source?: string;
}

/** "Why" list: label + 64 px weight bar + optional source stamp (design/README §3). */
export function FactorRows({ factors, className }: { factors: Factor[]; className?: string }) {
  return (
    <ul className={clsx("flex flex-col gap-3", className)}>
      {factors.map((f) => {
        const w = Math.max(0, Math.min(1, f.weight));
        return (
          <li key={f.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="block h-1.5 w-16 shrink-0 overflow-hidden rounded-chip bg-muted" aria-hidden>
              <span className="block h-full origin-left bg-ink" style={{ transform: `scaleX(${w})` }} />
            </span>
            <span className="text-body text-ink">
              {f.label}
              {f.value && <span className="ml-2 font-mono text-ink-2">{f.value}</span>}
              <span className="sr-only"> ({Math.round(w * 100)}%)</span>
            </span>
            {f.source && <Chip tone="source">{f.source}</Chip>}
          </li>
        );
      })}
    </ul>
  );
}
