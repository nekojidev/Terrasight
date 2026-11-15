import { describe, expect, it } from "vitest";
import { canDoFieldWork } from "./permissions";

describe("canDoFieldWork", () => {
  it("is read-only for the Owner and open for the Agronomist", () => {
    expect(canDoFieldWork("owner")).toBe(false);
    expect(canDoFieldWork("agronomist")).toBe(true);
  });
});
