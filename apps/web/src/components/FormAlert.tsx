import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

/** A form-level error: icon plus words, announced to screen readers. Field errors stay next to their field. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-3 rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
