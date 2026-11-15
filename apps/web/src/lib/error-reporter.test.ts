import { describe, expect, it } from "vitest";
import { buildEnvelope, parseDsn } from "./error-reporter";

describe("error reporter", () => {
  it("parses a DSN into the envelope endpoint", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/42")).toEqual({
      url: "https://o1.ingest.sentry.io/api/42/envelope/?sentry_key=abc123&sentry_version=7",
      key: "abc123",
    });
  });
  it("is off without a usable DSN", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o1.ingest.sentry.io/")).toBeNull();
  });
  it("builds a three-line envelope", () => {
    const lines = buildEnvelope("https://k@h/1", new Error("boom"), "https://x/y").split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!).exception.values[0].value).toBe("boom");
  });
});
