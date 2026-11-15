import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { redactUrl, reqSerializer } from "./redact.js";
import { securityHeaders } from "./security-headers.js";

describe("redactUrl", () => {
  it.each([
    ["/api/r/SECRETtoken123", "/api/r/[redacted]"],
    ["/api/r/SECRETtoken123/decisions/abc/answer", "/api/r/[redacted]/decisions/abc/answer"],
    ["/api/auth/setup/SECRET", "/api/auth/setup/[redacted]"],
    ["/api/auth/reset/SECRET", "/api/auth/reset/[redacted]"],
    ["/api/auth/reset/SECRET/x", "/api/auth/reset/[redacted]/x"],
    ["/api/scouting-photos/abc?op=get&exp=1&sig=SECRETSIG", "/api/scouting-photos/abc"],
    ["/api/w/1/fields?x=1#frag", "/api/w/1/fields"],
    ["/api/r/SECRET?x=1", "/api/r/[redacted]"],
  ])("%s", (input, want) => {
    expect(redactUrl(input)).toBe(want);
  });
  it("leaves other routes alone", () => {
    expect(redactUrl("/api/me")).toBe("/api/me");
    expect(redactUrl(undefined)).toBe("");
  });
});

describe("req serializer (pino-http)", () => {
  it("never emits a token or a signature", () => {
    const req = {
      id: 1,
      method: "POST",
      url: "/api/auth/reset/SECRETtoken/x?sig=SECRETSIG",
      headers: { host: "x" },
      socket: {},
    };
    const out = JSON.stringify(reqSerializer(req));
    expect(out).toContain("/api/auth/reset/[redacted]/x");
    expect(out).not.toContain("SECRET");
  });
});

describe("securityHeaders", () => {
  it("sets nosniff and frame-ancestors none, HSTS only when asked", () => {
    const run = (hsts: boolean) => {
      const headers: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
      const next = vi.fn();
      securityHeaders({ hsts })({} as Request, res, next);
      expect(next).toHaveBeenCalled();
      return headers;
    };
    const h = run(false);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Strict-Transport-Security"]).toBeUndefined();
    expect(run(true)["Strict-Transport-Security"]).toBeDefined();
  });
});
