import { ApiError } from "@/lib/api";

export type AuthErrorKind = "bad" | "taken" | "rate" | "net" | "invalid" | "gone" | "server";

/** Sorts a failed auth call into the few cases the screens word specifically. */
export function authErrorKind(e: unknown): AuthErrorKind {
  if (e instanceof ApiError) {
    if (e.code === "bad-credentials") return "bad";
    if (e.code === "email-taken" || e.code === "email-in-use") return "taken";
    if (e.code === "rate-limited") return "rate";
    if (e.code === "invalid-input") return "invalid";
    if (e.code === "setup-link-invalid" || e.code === "reset-link-invalid") return "gone";
    return "server";
  }
  return e instanceof TypeError ? "net" : "server";
}

/** Minutes to show for "try again in N minutes": the API limits per minute window. */
export const RATE_LIMIT_MINUTES = 1;

export const isEmail = (v: string): boolean => /^\S+@\S+\.\S+$/.test(v.trim());
