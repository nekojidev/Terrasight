import { clsx } from "clsx";
import type { ReactNode } from "react";

/** Centred page column: max width from --ts-page / --ts-page-narrow, standard side padding. */
export function PageContainer({
  width = "wide",
  className,
  children,
}: {
  width?: "wide" | "narrow";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "mx-auto w-full px-4 sm:px-6",
        width === "wide" ? "max-w-[var(--ts-page)]" : "max-w-[var(--ts-page-narrow)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
