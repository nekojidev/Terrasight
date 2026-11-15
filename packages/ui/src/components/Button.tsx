import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "signal" | "outline" | "ghost" | "link" | "icon";
export type ButtonSize = 44 | 48 | 52 | 56;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Required for `variant="icon"`: icon buttons have no visible text. */
  label?: string;
}

const HEIGHT: Record<ButtonSize, string> = {
  44: "h-11 px-4",
  48: "h-12 px-5",
  52: "h-13 px-6",
  56: "h-14 px-6",
};

const VARIANT: Record<ButtonVariant, string> = {
  // Primary is ink; in the dark theme --ts-ink is light and --ts-surface dark, so it inverts on its own.
  primary: "bg-ink text-surface hover:opacity-90 active:opacity-80",
  // Signal: lime fill with ink text, only for "Save to the 2026 plan" on the ink banner (design/README §3).
  signal: "bg-signal text-on-signal hover:brightness-95 active:brightness-90",
  outline: "border border-line-control bg-surface text-ink hover:bg-surface-2 active:bg-muted",
  ghost: "bg-muted text-ink hover:brightness-95 active:brightness-90",
  link: "h-auto px-0 text-ink underline underline-offset-4 hover:text-ink-2",
  icon: "size-11 px-0 justify-center border border-line-control bg-surface text-ink hover:bg-surface-2",
};

export function Button({
  variant = "primary",
  size = 44,
  icon,
  label,
  className,
  children,
  type,
  ...rest
}: ButtonProps) {
  const isIcon = variant === "icon";
  return (
    <button
      type={type ?? "button"}
      aria-label={isIcon ? label : rest["aria-label"]}
      title={isIcon ? label : rest.title}
      className={clsx(
        "focus-ring inline-flex min-h-tap shrink-0 items-center gap-2 rounded-btn text-body font-semibold",
        "transition-[opacity,filter,background-color] duration-bar ease-ts",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variant !== "link" && !isIcon && HEIGHT[size],
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon && (
        <span aria-hidden className="inline-flex [&>svg]:size-5 [&>svg]:stroke-[1.7]">
          {icon}
        </span>
      )}
      {!isIcon && children}
    </button>
  );
}
