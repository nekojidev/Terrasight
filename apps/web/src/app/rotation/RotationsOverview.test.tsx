import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import design from "../../../messages/en.json";
import app from "../../messages/app.en.json";
import { RotationsOverview, type Overview } from "./RotationsOverview";

let payload: Overview;
const stressData = {
  status: "unavailable",
  stressYear: 2022,
  season: 2026,
  currency: null,
  current: null,
  recommended: null,
  difference: null,
  counted: [],
  notCounted: [],
};
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: vi.fn(async (path: string) => (path.endsWith("/farm-stress") ? stressData : payload)) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NextIntlClientProvider locale="en" messages={{ ...design, ...app }}>
      {ui}
    </NextIntlClientProvider>
  </QueryClientProvider>
);

const field = (over: Partial<Overview["fields"][number]>): Overview["fields"][number] => ({
  fieldId: "f1",
  name: "North 12",
  areaHa: 20,
  county: null,
  irrigation: "none",
  hasLibrary: true,
  recent: [],
  plan: null,
  recommendation: null,
  ...over,
});

describe("Plan overview", () => {
  it("lists every status with a word and links to the field's rotation", async () => {
    payload = {
      season: 2026,
      horizon: [2026, 2030],
      cropNames: { corn: { en: "Corn", uk: "Кукурудза" } },
      fields: [
        field({ fieldId: "a", name: "Saved field", plan: { crop: "corn", rotationId: null } }),
        field({
          fieldId: "b",
          name: "Proposed field",
          recommendation: { level: "x", firstCrop: "corn", bestOption: "r1", deadline: null },
        }),
        field({ fieldId: "c", name: "Fresh field" }),
        field({ fieldId: "d", name: "Wet field", suitability: { status: "unsuitable", reasons: [] } }),
      ],
    };
    render(wrap(<RotationsOverview workspaceId="w" units="metric" />));
    expect(await screen.findByRole("heading", { level: 1, name: "Plan" })).toBeTruthy();
    for (const word of ["Saved to the plan", "Proposed", "Not calculated yet", "Land unsuitable"])
      expect((await screen.findAllByText(word)).length).toBeGreaterThan(0);
    // "Compare options" only where there are options; the saved plan opens as "Open the plan"
    const saved = screen.getAllByRole("link", { name: /Open the plan for Saved field/ });
    expect(saved[0]?.getAttribute("href")).toBe("/fields/a/rotation");
    expect(screen.getAllByRole("link", { name: /Compare options for Proposed field/ })[0]).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Compare options for Fresh field/ })).toBeNull();
    // one-line summary and the proposed (needs a decision) row first
    expect(screen.getByTestId("plan-summary").textContent).toBe("1 of 4 fields needs a decision");
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(rows[1]).toContain("Proposed field");
    // the farm stress section the home line links to
    expect(document.getElementById("stress")).toBeTruthy();
  });

  it("offers one action when there are no fields", async () => {
    payload = { season: 2026, horizon: [2026, 2030], cropNames: {}, fields: [] };
    render(wrap(<RotationsOverview workspaceId="w" units="metric" />));
    expect(await screen.findByRole("button", { name: "Add a field" })).toBeTruthy();
  });
});
