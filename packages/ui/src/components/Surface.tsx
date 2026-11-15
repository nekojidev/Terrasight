import { clsx } from "clsx";
import type { ElementType, HTMLAttributes, ReactNode } from "react";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  tone?: "card" | "inset" | "hero";
  pad?: "none" | "sm" | "md" | "lg";
  children?: ReactNode;
}

const TONE = {
  card: "rounded-card border border-line bg-surface",
  inset: "rounded-card border border-line bg-surface-2",
  hero: "rounded-hero border border-line bg-surface shadow-hero",
};
const PAD = { none: "", sm: "p-4", md: "p-5", lg: "p-6" };

/** The one card recipe: card (default), inset panel, or raised hero. */
export function Surface({ as, tone = "card", pad = "md", className, children, ...rest }: SurfaceProps) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag className={clsx(TONE[tone], PAD[pad], className)} {...rest}>
      {children}
    </Tag>
  );
}
