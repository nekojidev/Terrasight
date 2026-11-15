"use client";

import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

const control =
  "focus-ring block w-full min-h-13 rounded-input border border-line-strong bg-surface px-4 text-body text-ink placeholder:text-ink-3 aria-[invalid=true]:border-urgent";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Optional control inside the field's right edge (e.g. a show-password button). */
  trailing?: ReactNode;
}

/** Labelled input with hint and error (design 01, 02). */
export function TextField({ label, hint, error, trailing, className, id, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label htmlFor={inputId} className="text-small font-semibold text-ink">
        {label}
      </label>
      <span className="relative block">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? hintId : undefined}
          className={clsx(control, trailing && "pr-14")}
          {...rest}
        />
        {trailing && <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>}
      </span>
      {(error || hint) && (
        <p id={hintId} className={clsx("text-small", error ? "text-urgent" : "text-ink-2")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
}

/** Native select styled as a field: keyboard and screen-reader friendly by default. */
export function SelectField({ label, hint, options, className, id, ...rest }: SelectFieldProps) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label htmlFor={selectId} className="text-small font-semibold text-ink">
        {label}
      </label>
      <span className="relative">
        <select
          id={selectId}
          aria-describedby={hint ? `${selectId}-hint` : undefined}
          className={clsx(control, "appearance-none pr-12 font-semibold")}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-ink"
          strokeWidth={1.7}
        />
      </span>
      {hint && (
        <p id={`${selectId}-hint`} className="text-small text-ink-2">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** "wide" = equal halves (units), "compact" = small pill group (UA / EN). */
  variant?: "wide" | "compact";
  hideLabel?: boolean;
  className?: string;
}

/** Radio group drawn as segments (design 02: units, report language). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = "wide",
  hideLabel,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset
      className={clsx(
        "flex gap-3",
        variant === "wide" ? "flex-col" : "items-center justify-between",
        className,
      )}
    >
      <legend
        className={clsx(
          "mb-2 text-small font-semibold text-ink",
          hideLabel && "sr-only",
          variant === "compact" && "float-left mb-0",
        )}
      >
        {label}
      </legend>
      <div
        className={clsx(
          variant === "wide"
            ? "grid grid-cols-2 gap-2"
            : "ml-auto flex rounded-input border border-line bg-muted p-1",
        )}
      >
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={clsx(
                "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink",
                "flex min-h-tap cursor-pointer items-center justify-center text-body font-semibold",
                variant === "wide"
                  ? clsx(
                      "rounded-btn border",
                      checked ? "border-ink bg-muted text-ink" : "border-line-strong bg-surface text-ink",
                    )
                  : clsx("rounded-btn px-4", checked ? "bg-surface text-ink shadow-sm" : "text-ink-2"),
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
