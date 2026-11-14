import { describe, expect, it } from "vitest";
import { thumbPath } from "./thumb.js";

const poly = (ring: number[][]) => JSON.stringify({ type: "Polygon", coordinates: [ring] });

describe("thumbPath", () => {
  it("fits the outline into a 0-100 box, keeping aspect ratio and flipping north up", () => {
    // ~2:1 rectangle at the equator
    const d = thumbPath(
      poly([
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
        [0, 0],
      ]),
    )!;
    expect(d).toBe("M0 75L100 75L100 25L0 25Z");
  });
  it("handles MultiPolygon and returns null for empty input", () => {
    const mp = JSON.stringify({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [2, 0],
            [3, 0],
            [3, 1],
            [2, 0],
          ],
        ],
      ],
    });
    expect(thumbPath(mp)!.match(/M/g)).toHaveLength(2);
    expect(thumbPath(null)).toBeNull();
  });
});
