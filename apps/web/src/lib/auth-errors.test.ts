import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { authErrorKind, isEmail } from "./auth-errors";

const problem = (code: string, status = 400) =>
  new ApiError({ type: `/problems/${code}`, title: code, status });

describe("authErrorKind", () => {
  it("names the cases the screens word specifically", () => {
    expect(authErrorKind(problem("bad-credentials", 401))).toBe("bad");
    expect(authErrorKind(problem("email-taken", 409))).toBe("taken");
    expect(authErrorKind(problem("rate-limited", 429))).toBe("rate");
    expect(authErrorKind(problem("invalid-input", 422))).toBe("invalid");
    expect(authErrorKind(problem("setup-link-invalid", 404))).toBe("gone");
    expect(authErrorKind(problem("reset-link-invalid", 404))).toBe("gone");
    expect(authErrorKind(problem("boom", 500))).toBe("server");
  });

  it("treats a failed request as no network", () => {
    expect(authErrorKind(new TypeError("network"))).toBe("net");
    expect(authErrorKind(new Error("x"))).toBe("server");
  });

  it("checks the email shape", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("")).toBe(false);
  });
});
