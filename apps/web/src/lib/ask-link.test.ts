import { describe, expect, it } from "vitest";
import { askHref } from "./ask-link";
import { askHref as reExported } from "./assistant-context";

describe("askHref", () => {
  it("builds /assistant?ask=<question>&field=<id>", () => {
    expect(askHref("Why is North quarter at risk?", { fieldId: "abc-1" })).toBe(
      "/assistant?ask=Why%20is%20North%20quarter%20at%20risk%3F&field=abc-1",
    );
  });
  it("leaves the field out when there is none and encodes every special character", () => {
    expect(askHref("What if prices fall by 20 % & more?")).toBe(
      "/assistant?ask=What%20if%20prices%20fall%20by%2020%20%25%20%26%20more%3F",
    );
    const u = new URL(askHref("Чому поле «Північ» під ризиком?", { fieldId: "a b" }), "http://x");
    expect(u.searchParams.get("ask")).toBe("Чому поле «Північ» під ризиком?");
    expect(u.searchParams.get("field")).toBe("a b");
  });
  it("is also exported from assistant-context", () => {
    expect(reExported).toBe(askHref);
  });
});
