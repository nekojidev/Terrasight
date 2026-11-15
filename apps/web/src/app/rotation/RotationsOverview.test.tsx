import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import design from "../../../messages/en.json";
import app from "../../messages/app.en.json";
import { RotationsOverview, type Overview } from "./RotationsOverview";

let payload: Overview;
vi.mock("@/lib/api", () => ({ api: vi.fn(async () => payload) }));
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
    const links = screen.getAllByRole("link", { name: /Compare options for Saved field/ });
    expect(links[0]?.getAttribute("href")).toBe("/fields/a/rotation");
  });

  it("offers one action when there are no fields", async () => {
    payload = { season: 2026, horizon: [2026, 2030], cropNames: {}, fields: [] };
    render(wrap(<RotationsOverview workspaceId="w" units="metric" />));
    expect(await screen.findByRole("button", { name: "Add a field" })).toBeTruthy();
  });
});
