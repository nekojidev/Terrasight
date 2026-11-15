import { describe, expect, it } from "vitest";
import {
  activeKey,
  clearActive,
  latestForFieldPath,
  pickActive,
  readActive,
  titleFromQuestion,
  writeActive,
} from "./assistant-context";

const A = "123e4567-e89b-42d3-a456-426614174000";
const B = "223e4567-e89b-42d3-a456-426614174000";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("active conversation per context", () => {
  it("keeps one id per field and one global, per workspace", () => {
    const s = memory();
    writeActive("w1", "f1", A, s);
    writeActive("w1", undefined, B, s);
    expect(readActive("w1", "f1", s)).toBe(A);
    expect(readActive("w1", null, s)).toBe(B);
    expect(readActive("w1", "f2", s)).toBeNull();
    expect(readActive("w2", "f1", s)).toBeNull();
    expect(activeKey("w1")).toBe(activeKey("w1", null));
  });
  it("clears one context (New chat) and leaves the others", () => {
    const s = memory();
    writeActive("w", "f1", A, s);
    writeActive("w", "f2", B, s);
    clearActive("w", "f1", s);
    expect(readActive("w", "f1", s)).toBeNull();
    expect(readActive("w", "f2", s)).toBe(B);
  });
  it("ignores junk values and blocked storage", () => {
    const s = memory();
    s.setItem(activeKey("w", "f"), "not-a-uuid");
    expect(readActive("w", "f", s)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readActive("w", "f", broken)).toBeNull();
    expect(() => writeActive("w", "f", A, broken)).not.toThrow();
    expect(() => clearActive("w", "f", broken)).not.toThrow();
    expect(readActive("w", "f", null)).toBeNull();
  });
  it("prefers this tab's choice over the server's latest", () => {
    expect(pickActive(A, B)).toBe(A);
    expect(pickActive(null, B)).toBe(B);
    expect(pickActive(null, undefined)).toBeNull();
  });
  it("builds the latest-by-field lookup", () => {
    expect(latestForFieldPath("w", "f 1")).toBe("/api/w/w/conversations?fieldId=f%201");
  });
});

describe("titleFromQuestion", () => {
  it("uses the first question, trimmed", () => {
    expect(titleFromQuestion("  Why \n is it  risky? ")).toBe("Why is it risky?");
    expect(titleFromQuestion("a".repeat(80))).toHaveLength(60);
  });
});
