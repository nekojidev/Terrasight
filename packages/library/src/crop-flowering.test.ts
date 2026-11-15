import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCropFlowering, loadLibrary, parseCropFlowering } from "./index.js";

const DATA = fileURLToPath(new URL("../../../data/", import.meta.url));
const text = readFileSync(`${DATA}crop-flowering.json`, "utf8");

describe("crop-flowering.json", () => {
  const { file, problems } = parseCropFlowering(text);

  it("is valid and every entry is unreviewed with sources on every value", () => {
    expect(problems).toEqual([]);
    expect(Object.keys(file!.crops).length).toBeGreaterThan(0);
    for (const c of Object.values(file!.crops)) {
      expect(c.verified).toBe(false);
      expect(c.threshold.sources.length).toBeGreaterThan(0);
    }
    expect(text).not.toContain("verifiedBy");
  });

  it("knows only crops and regions of the library", () => {
    const lib = loadLibrary(DATA);
    expect(
      checkCropFlowering(file!, { crops: Object.keys(lib.rotations.crops), regions: Object.keys(lib.rotations.regions) }),
    ).toEqual([]);
  });

  it("rejects a value without a source, a bad date and an unknown crop", () => {
    const bad = JSON.parse(text);
    bad.crops.corn.threshold.sources = [];
    bad.crops.corn.window.afterEmergence.sources[0].accessed = "yesterday";
    expect(parseCropFlowering(JSON.stringify(bad)).problems.length).toBeGreaterThanOrEqual(2);
    const ok = parseCropFlowering(text).file!;
    expect(checkCropFlowering({ ...ok, crops: { nope: ok.crops.corn! } }, { crops: ["corn"], regions: [] })).toHaveLength(1);
  });
});
