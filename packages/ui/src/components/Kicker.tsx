import { clsx } from "clsx";
import type { ElementType, ReactNode } from "react";

/** Uppercase mono label ("kicker") in tertiary ink. */
export function Kicker({
  children,
  className,
  as,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  const Tag: ElementType = as ?? "p";
  return <Tag className={clsx("kicker", className)}>{children}</Tag>;
}
