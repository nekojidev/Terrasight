import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@terrasight/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import design from "../../../../../messages/en.json";
import app from "../../../../messages/app.en.json";
import { RotationClient } from "./RotationClient";

let run: unknown;
let runError = false;
vi.mock("@/lib/api", () => ({
  api: vi.fn(async (path: string) => {
    if (path.endsWith("/scenario-runs")) {
      if (runError) throw new Error("boom");
      return run;
    }
    return {};
  }),
}));
vi.mock("../Overview", () => ({ FieldTabs: () => <nav aria-label="Field sections" /> }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  runError = false;
});

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NextIntlClientProvider locale="en" messages={{ ...design, ...app }}>
      <ToastProvider dismissLabel="Dismiss">{ui}</ToastProvider>
    </NextIntlClientProvider>
  </QueryClientProvider>
);

const scenario = (id: string, kind: "current" | "alternative", over: Record<string, unknown> = {}) => ({
  id,
  kind,
  plan: [2026, 2027, 2028, 2029, 2030].map((season) => ({ season, crops: [id === "cur" ? "corn" : "alfalfa"] })),
  margin: id === "cur" ? 300 : 420,
  marginBySeason: [300, 300, 300, 300, 300],
  water: 200,
  carbonChange: 0.1,
  erosion: 40,
  drought: 100,
  droughtYield: 0.8,
  if2022: { margin: 100, typical: 300, season: 2027 },
  priceWins: id === "cur" ? 10 : 7,
  capped: false,
  capLoss: 0,
  pestPressure: [{ pest: "western_corn_rootworm", seasons: 1 }],
  caveats: [],
  relaxed: [],
  delta: { margin: id === "cur" ? 0 : 120, water: 0, soil: 0, drought: 0 },
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  id: "run1",
  noLibrary: false,
  firstSeason: 2026,
  regionVerify: false,
  missingPrices: [],
  pending: null,
  regionId: "ua-steppe",
  currentBasis: "baseline",
  soilBasis: "soilgrids",
  mode: "money",
  currency: "UAH",
  priceLabel: "company",
  priceAsOf: "2025",
  names: { alt: { en: "Alfalfa base", uk: "Люцерна" } },
  cropNames: { corn: { en: "Corn", uk: "Кукурудза" }, alfalfa: { en: "Alfalfa", uk: "Люцерна" } },
  result: {
    current: scenario("cur", "current"),
    alternatives: [scenario("alt", "alternative")],
    candidates: 1,
    relaxed: ["precipitation", "mystery_filter"],
    bestFit: "alt",
  },
  ...over,
});

const mount = (canSave = true) =>
  render(
    wrap(
      <RotationClient workspaceId="w" fieldId="f" fieldName="North 12" units="metric" canSave={canSave} />,
    ),
  );

describe("Rotation page", () => {
  it("leads with the headline and one primary save button, in the agreed order", async () => {
    run = payload();
    const { container } = mount();
    const save = await screen.findByRole("button", { name: /Save to the 2026 plan/ });
    const text = container.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at("Sow Alfalfa")).toBeGreaterThan(-1);
    expect(at("Reliability")).toBeGreaterThan(at("Sow Alfalfa"));
    expect(at("We compared 2 options")).toBeGreaterThan(at("Reliability"));
    expect(at("What the field earns over 5 seasons")).toBeGreaterThan(at("We compared 2 options"));
    expect(at("If a year like 2022 happens again")).toBeGreaterThan(at("What the field earns over 5 seasons"));
    expect(at("Test robustness")).toBeGreaterThan(at("If a year like 2022 happens again"));
    expect(screen.getAllByRole("button", { name: /Save to the 2026 plan/ })).toHaveLength(1);
    expect(save.className).toContain("bg-ink");
    // Money uses the company currency and the price source is the company's, not USDA.
    expect(text).toMatch(/UAH|₴/);
    expect(text).not.toContain("USDA NASS");
    expect(text).toContain("Your company prices");
  });

  it("uses native radios for the priority and aria-pressed for the options", async () => {
    run = payload();
    mount();
    await screen.findByRole("button", { name: /Save to the 2026 plan/ });
    const group = screen.getByRole("radiogroup");
    expect(group.querySelectorAll('input[type="radio"]').length).toBe(4);
    const choose = screen.getAllByRole("button", { name: /Choose this option|Chosen/ });
    expect(choose.every((b) => b.getAttribute("aria-pressed") !== null)).toBe(true);
    fireEvent.click(choose.find((b) => b.getAttribute("aria-pressed") === "false")!);
    expect(screen.getAllByRole("button", { name: "Chosen" })).toHaveLength(1);
  });

  it("never shows raw pest or filter ids", async () => {
    run = payload({
      result: {
        ...payload().result,
        current: scenario("cur", "current", {
          pestPressure: [
            { pest: "western_corn_rootworm", seasons: 2 },
            { pest: "totally_unknown_pest", seasons: 1 },
          ],
        }),
      },
    });
    const { container } = mount();
    await screen.findByRole("button", { name: /Save to the 2026 plan/ });
    const text = container.textContent ?? "";
    expect(text).toContain("Western corn rootworm");
    expect(text).toContain("a pest or disease");
    expect(text).not.toMatch(/western_corn_rootworm|totally_unknown_pest|mystery_filter|precipitation,/);
  });

  it("shows one notice only and keeps the rest in the notes", async () => {
    run = payload({ mode: "agronomy", currentBasis: "estimated", cropsNeedingPrices: ["corn"] });
    mount();
    await screen.findByText("No prices for your crops yet");
    expect(screen.getAllByText(/^No prices for your crops yet$/)).toHaveLength(1);
    expect(screen.queryByText("What did grow here recently?")).toBeNull();
    expect(screen.getByRole("button", { name: "Notes on these numbers" })).toBeTruthy();
  });

  it("says who can change the plan when read-only", async () => {
    run = payload();
    mount(false);
    await screen.findByText(/Only an Agronomist can save this plan/);
    expect(screen.queryByRole("button", { name: /Save to the 2026 plan/ })).toBeNull();
  });

  it("shows the long-operation pattern while loading and an error card with Retry on failure", async () => {
    run = payload();
    mount();
    expect(screen.getByText(/Usually under a minute/)).toBeTruthy();
    cleanup();
    runError = true;
    mount();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
