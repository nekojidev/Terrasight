import { clsx } from "clsx";
import type { ReactNode } from "react";

/** Right-rail card of the brief: mono uppercase title + content (design/README §3). */
export function RailCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-card border border-line bg-surface p-5", className)}>
      <h2 className="text-micro mb-4 text-ink-2">{title}</h2>
      {children}
    </section>
  );
}
