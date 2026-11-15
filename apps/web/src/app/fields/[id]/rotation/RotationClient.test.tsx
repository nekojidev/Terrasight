import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@terrasight/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import design from "../../../../../messages/en.json";
import app from "../../../../messages/app.en.json";
import type { YearSetComparison, YearSetId } from "@terrasight/shared";
import { RotationClient } from "./RotationClient";

let run: unknown;
let runError = false;
let runGate: Promise<void> | null = null;
let climate: unknown = { status: "pending" };
let yearSets: unknown = null;
let yearSetsStatus = 0;
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(async (path: string) => {
      if (path.endsWith("/climate-shift")) return climate;
      if (path.endsWith("/year-sets")) {
        if (yearSetsStatus)
          throw new actual.ApiError({ type: "about:blank", title: "x", status: yearSetsStatus });
        return yearSets;
      }
      if (path.endsWith("/scenario-runs")) {
        if (runGate) await runGate;
        if (runError) throw new Error("boom");
        return run;
      }
      return {};
    }),
  };
});
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
  runGate = null;
  climate = { status: "pending" };
  yearSets = null;
  yearSetsStatus = 0;
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

const readyClimate = {
  status: "ready",
  periods: { baseline: { from: 1981, to: 2000 }, recent: { from: 2006, to: 2025 } },
  hemisphere: "north",
  season: { from: "04-01", to: "09-30" },
  crop: "corn",
  flowering: { from: "07-01", to: "07-31", thresholdC: 35, verified: false, fallback: true, source: null },
  metrics: [],
  alpha: 0.05,
  skippedYears: [],
  source: { dataset: "NASA POWER", from: "1981-01-01", lastDate: "2025-10-30", cell: { lat: 37.9, lon: -100.9 }, resolutionKm: 55 },
  gpm: null,
};

/** Four sets; `bests` is the rank-1 option id per set (all, 1981–2000, last 15, trend). Ids: "cur" and "alt". */
const comparison = (bests: [string, string, string, string]): YearSetComparison => {
  const ids: YearSetId[] = ["all", "climate-1981-2000", "last-15", "trend-2030"];
  return {
    mode: "money",
    currency: "UAH",
    bestChanges: new Set(bests).size > 1,
    names: { alt: { en: "Alfalfa base", uk: "Люцерна" } },
    sets: ids.map((id, k) => {
      const best = bests[k]!;
      const other = best === "alt" ? "cur" : "alt";
      return {
        id,
        years: { from: id === "climate-1981-2000" ? 1981 : id === "all" ? 1982 : 2011, to: id === "climate-1981-2000" ? 2000 : 2025, count: id === "all" ? 44 : 15 },
        shift: id === "trend-2030" ? { deltaT: 0.2, precipFactor: 1, applied: { temperature: true, precipitation: false } } : null,
        best,
        options: [
          { id: best, rank: 1, margin: 400, drought: 250, score: 1 },
          { id: other, rank: 2, margin: 300, drought: 200, score: 0.5 },
        ],
      };
    }),
  };
};

const loadedBlock = async (): Promise<HTMLElement> => {
  const block = (await screen.findByRole("region", { name: "Sensitivity to the weather years" })) as HTMLElement;
  await waitFor(() => expect(block.querySelector("[data-year-set]")).toBeTruthy());
  return block;
};

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

  it("renders the climate card before the run resolves, and the Save button does not wait for the year sets", async () => {
    let open!: () => void;
    runGate = new Promise<void>((res) => (open = res));
    run = payload();
    climate = readyClimate;
    mount();
    expect(await screen.findByText(/Field shift · NASA POWER/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save to the 2026 plan/ })).toBeNull();
    expect(screen.getByText(/Usually under a minute/)).toBeTruthy();
    // the year-set comparison never resolves: Save still works
    yearSets = new Promise(() => {});
    open();
    expect(await screen.findByRole("button", { name: /Save to the 2026 plan/ })).toBeTruthy();
  });

  it("shows the sensitivity block with the same best option in every set, and one hero sentence", async () => {
    run = payload();
    yearSets = comparison(["alt", "alt", "alt", "alt"]);
    const { container } = mount();
    const block = await loadedBlock();
    expect(within(block).getByText(/Not a climate forecast/)).toBeTruthy();
    expect(within(block).getAllByRole("listitem").filter((li) => li.hasAttribute("data-year-set"))).toHaveLength(4);
    const cols = [...block.querySelectorAll("[data-year-set]")].map((c) => c.getAttribute("data-year-set"));
    expect(cols).toEqual(["all", "climate-1981-2000", "last-15", "trend-2030"]);
    expect(within(block).getAllByText("best in this set")).toHaveLength(4);
    expect(within(block).getAllByText("recommended")).toHaveLength(4);
    expect(within(block).getByText(/\+0\.2\s?°C; rainfall unchanged because its trend is not clear/)).toBeTruthy();
    expect(within(block).getByText("The same option is best in every set of years.")).toBeTruthy();
    expect(container.textContent).toContain("The order of the options is the same in every set of weather years.");
    expect(container.textContent).not.toMatch(/forecast of the climate/);
    // the block comes after the 2022 check
    const text = container.textContent ?? "";
    expect(text.indexOf("Sensitivity to the weather years")).toBeGreaterThan(text.indexOf("If a year like 2022 happens again"));
  });

  it("states a change only when the data has one, including the current rotation note", async () => {
    run = payload();
    yearSets = comparison(["alt", "cur", "alt", "alt"]);
    const { container } = mount();
    const block = await loadedBlock();
    const concl = within(block).getByTestId("year-sets-conclusion").textContent ?? "";
    expect(concl).toContain("With all years, B · Alfalfa base is best.");
    expect(concl).toContain("With the 1981–2000 climate, A · ");
    expect(concl).not.toContain("With the last 15 years");
    expect(concl).not.toContain("trend continued");
    expect(concl).toContain("The current rotation was the best in the 1981–2000 climate; in the last 15 years it ranks 2.");
    expect(container.textContent).toContain("With the 1981–2000 climate, A · ");
    expect(container.textContent).not.toContain("The order of the options is the same");
  });

  it("derives the finding from the rankings, not from the bestChanges flag", async () => {
    run = payload();
    const c = comparison(["alt", "alt", "alt", "alt"]);
    yearSets = { ...c, bestChanges: true };
    mount();
    const block = await loadedBlock();
    expect(within(block).getByText("The same option is best in every set of years.")).toBeTruthy();
  });

  it("copes with a missing set and says which one", async () => {
    run = payload();
    const c = comparison(["alt", "alt", "alt", "alt"]);
    yearSets = { ...c, sets: c.sets.filter((x) => x.id !== "last-15") };
    mount();
    const block = await loadedBlock();
    expect(block.querySelectorAll("[data-year-set]")).toHaveLength(3);
    expect(within(block).getByText(/Last 15 years: Not calculated for this set/)).toBeTruthy();
    expect(within(block).getByText(/that could be calculated/)).toBeTruthy();
  });

  it("a 404 shows 'not available yet' with Retry and leaves the page working", async () => {
    run = payload();
    yearSetsStatus = 404;
    mount();
    expect(await screen.findByText("Not available yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save to the 2026 plan/ })).toBeTruthy();
    expect(screen.queryByText(/same in every set/)).toBeNull();
  });

  it("renders the NASA block and the weather years from the run, and nothing fixed when they are absent", async () => {
    run = payload({
      dataBasis: [
        { dataset: "NASA POWER", agency: "NASA", from: "1981-01-01", to: "2025-10-30", lastDate: "2025-10-30", supports: ["weather-years"] },
      ],
      weather: { yearSet: "all", from: 1982, to: 2025, count: 44, lastDate: "2025-10-30" },
    });
    const { container } = mount();
    await screen.findByRole("button", { name: /Save to the 2026 plan/ });
    expect(screen.getByText("What NASA data contributed here")).toBeTruthy();
    expect(container.textContent).toContain("harvest years 1982–2025 (44 seasons), last data");
    expect(screen.getAllByRole("link", { name: /How far can you trust this/ }).length).toBeGreaterThan(0);
    cleanup();
    run = payload();
    const second = mount();
    await screen.findByRole("button", { name: /Save to the 2026 plan/ });
    expect(screen.queryByText("What NASA data contributed here")).toBeNull();
    expect(second.container.textContent).not.toMatch(/harvest years|1981–2025/);
    expect(second.container.textContent).not.toMatch(/150 weather paths \(NASA/);
  });
});
