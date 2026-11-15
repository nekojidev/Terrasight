import { describe, expect, it } from "vitest";
import { isMorningDue, jitterMinutes, minutesOf } from "./scheduler.js";

describe("06:00 jitter", () => {
  const ids = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("is deterministic and inside the window", () => {
    for (const id of ids) {
      const j = jitterMinutes(id, 30);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(30);
      expect(jitterMinutes(id, 30)).toBe(j);
    }
  });

  it("spreads workspaces over the whole window", () => {
    const hist = new Array<number>(30).fill(0);
    for (const id of ids) hist[jitterMinutes(id, 30)]! += 1;
    expect(hist.every((n) => n > 0)).toBe(true);
    expect(Math.max(...hist)).toBeLessThan(ids.length / 30 * 2.5);
  });

  it("is zero with no window", () => {
    expect(jitterMinutes(ids[0]!, 0)).toBe(0);
  });

  it("makes a workspace due only after 06:00 plus its offset", () => {
    const id = ids.find((i) => jitterMinutes(i, 30) === 17)!;
    expect(isMorningDue(id, "06:16", 30)).toBe(false);
    expect(isMorningDue(id, "06:17", 30)).toBe(true);
    expect(isMorningDue(id, "05:59", 30)).toBe(false);
    expect(isMorningDue(id, "06:00", 0)).toBe(true);
    expect(minutesOf("06:30")).toBe(390);
  });
});
