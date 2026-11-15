import { clsx } from "clsx";

/** Terrasight mark + word (design 01–03). */
export function Brand({ inverted, className }: { inverted?: boolean; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-3 text-[22px] leading-7 font-bold",
        inverted ? "text-surface" : "text-ink",
        className,
      )}
    >
      <svg aria-hidden width="32" height="32" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="8" fill={inverted ? "transparent" : "var(--ts-ink)"} />
        <ellipse cx="15" cy="17" rx="9" ry="7" fill="none" stroke="var(--ts-surface)" strokeWidth="2.4" />
        <path
          d="M6 19c6-6 13-8 20-7"
          fill="none"
          stroke="var(--crop-soy)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="26" cy="9" r="2" fill="var(--ts-surface)" />
      </svg>
      <span className="sb-label">Terrasight</span>
    </span>
  );
}
