import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Retrospective, TrustReport, TrustYear } from "@terrasight/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import design from "../../../../../messages/en.json";
import app from "../../../../messages/app.en.json";
import { TrustClient } from "./TrustClient";
import { readCase2022, readFit } from "./trustView";

let report: TrustReport | Error;
const chartProps = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return {
    ...real,
    api: vi.fn(async (path: string) => {
      if (path.endsWith("/trust")) {
        if (report instanceof Error) throw report;
        return report;
      }
      return { cropNames: { corn: { en: "Corn", uk: "Кукурудза" } } };
    }),
  };
});
vi.mock("@/components/ModelVsActualChart", () => ({
  ModelVsActualChart: (p: unknown) => {
    chartProps(p);
    return <div data-testid="chart" />;
  },
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
  chartProps.mockClear();
});

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NextIntlClientProvider locale="en" messages={{ ...design, ...app }}>
      {ui}
    </NextIntlClientProvider>
  </QueryClientProvider>
);

const year = (y: number, over: Partial<TrustYear> = {}): TrustYear => ({
  year: y,
  crop: "corn",
  model: 5,
  county: 4,
  ndvi: 3,
  countyYield: 10,
  practice: "all",
  miss: false,
  reason: null,
  ...over,
});

const retro = (over: Partial<Retrospective> = {}): Retrospective => ({
  seasons: [2018, 2019],
  mode: "money",
  currency: "USD",
  current: { id: "a", bySeason: [300, 320], total: 620 },
  recommended: { id: "b", bySeason: [350, 280], total: 630 },
  priceBasis: "today",
  ...over,
});

const base = (over: Partial<TrustReport> = {}): TrustReport => ({
  status: "ready",
  fieldId: "f1",
  years: [2018, 2019, 2020, 2021, 2022, 2023].map((y) => year(y)),
  vsCounty: { n: 6, r: 0.82, mae: 4.5 },
  vsNdvi: { n: 6, r: 0.5, mae: 6 },
  actual: { kind: "nass", connected: true, area: "Finney County, KS", verified: true },
  case2022: year(2022, { model: -30, county: -25, ndvi: -18 }),
  notModelled: ["heat", "pests"],
  caveats: ["unverified-crop-parameters:corn"],
  retrospective: null,
  ...over,
});

const show = async (r: TrustReport | Error) => {
  report = r;
  render(wrap(<TrustClient workspaceId="w1" fieldId="f1" fieldName="North" />));
  await screen.findByRole("heading", { name: "How far can you trust this" });
  const busy = () =>
    screen.queryAllByLabelText("Loading the model-against-actual comparison").length +
    screen.queryAllByText("Loading the model-against-actual comparison").length;
  await waitFor(() => expect(busy()).toBe(0));
};

describe("TrustClient", () => {
  it("good fit: 2022 case first, numbers, reading, thresholds, source, chart props", async () => {
    await show(base());
    const heads = (await screen.findAllByRole("heading", { level: 2 })).map((h) => h.textContent);
    expect(heads[0]).toBe("2022: the record drought");
    expect(screen.getByText(/moved the same way, 5 points apart: within 10 points/)).toBeTruthy();
    expect(screen.getByText("r = 0.82, mean error 4.5 points, 6 years")).toBeTruthy();
    expect(screen.getByText("The model follows it closely.")).toBeTruthy();
    expect(screen.getByText("The model follows it loosely.")).toBeTruthy();
    expect(screen.getByText(/Reading rule: \|r\| of 0\.7 or more/)).toBeTruthy();
    expect(screen.getByText("Actual yields: USDA NASS county yields, Finney County, KS.")).toBeTruthy();
    expect(screen.getByText("Heat damage at flowering")).toBeTruthy();
    expect(screen.getByText(/How Corn responds to water and heat is not yet verified/)).toBeTruthy();
    const p = chartProps.mock.calls[0]![0] as { highlightYears: unknown[]; unitLabel: string; series: unknown[] };
    expect(p.highlightYears).toEqual([{ year: 2022, label: "2022" }]);
    expect(p.unitLabel).toBe("% from the usual level");
    expect(p.series).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Back to the field" }).getAttribute("href")).toBe("/fields/f1");
    expect(screen.getByRole("link", { name: "Go to the rotation" }).getAttribute("href")).toBe("/fields/f1/rotation");
  });

  it("poor fit says it does not follow and shows the numbers; missed years listed with reasons", async () => {
    await show(
      base({
        vsCounty: { n: 8, r: 0.12, mae: 22.3 },
        years: [
          year(2019, { model: 30, county: -10, miss: true, reason: "heat" }),
          year(2021, { model: 5, county: 40, miss: true, reason: "unknown" }),
        ],
      }),
    );
    expect(screen.getByText("r = 0.12, mean error 22.3 points, 8 years")).toBeTruthy();
    expect(screen.getByText("The model does not follow it.")).toBeTruthy();
    expect(screen.getByText("2019 · Corn")).toBeTruthy();
    expect(screen.getByText("model +30% · county −10%")).toBeTruthy();
    expect(screen.getByText(/does not include heat damage/)).toBeTruthy();
    expect(screen.getByText("We do not know why.")).toBeTruthy();
    expect((chartProps.mock.calls[0]![0] as { missYears: number[] }).missYears).toEqual([2019, 2021]);
  });

  it("too few years", async () => {
    await show(base({ vsCounty: { n: 3, r: null, mae: 7 } }));
    expect(screen.getByText("Too few years to say.")).toBeTruthy();
    expect(screen.getByText("r = no data, mean error 7.0 points, 3 years")).toBeTruthy();
  });

  it("county yields not connected", async () => {
    await show(base({ vsCounty: null, actual: { kind: "nass", connected: false, area: null, verified: false } }));
    expect(
      screen.getByText("County yields are not connected, so the comparison uses satellite greenness only."),
    ).toBeTruthy();
    expect(screen.getByText("There are no county yields, so missed years cannot be listed.")).toBeTruthy();
  });

  it("Ukraine: Derzhstat context, unverified", async () => {
    await show(
      base({ actual: { kind: "derzhstat", connected: true, area: "Poltava", verified: false }, case2022: null }),
    );
    expect(screen.getByText("Oblast yields (Poltava) from Derzhstat, not verified: shown as context.")).toBeTruthy();
    expect(screen.getByText("Model vs oblast yields (Derzhstat, not verified)")).toBeTruthy();
    const p = chartProps.mock.calls[0]![0] as { series: Array<{ id: string; label: string }> };
    expect(p.series.find((s) => s.id === "county")?.label).toBe("Oblast (Derzhstat, not verified)");
  });

  it("no 2022 case: the fit comes first", async () => {
    await show(base({ case2022: null }));
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads[0]).toBe("How closely the model follows what happened");
    expect(screen.queryByText("2022: the record drought")).toBeNull();
  });

  it("retrospective in money keeps the label and shows totals and difference", async () => {
    await show(base({ retrospective: retro() }));
    expect(screen.getByRole("heading", { name: "If this field had switched in 2018" })).toBeTruthy();
    expect(
      screen.getByText(
        "At today's prices. This compares two simulations on the real weather of those years; it is not what the field earned.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("$620").length).toBeGreaterThan(0);
    expect(screen.getByText("+$10")).toBeTruthy();
  });

  it("retrospective in agronomy mode shows relative yield, not money", async () => {
    await show(
      base({
        retrospective: retro({
          mode: "agronomy",
          currency: null,
          current: { id: "a", bySeason: [100, 90], total: 190 },
          recommended: { id: "b", bySeason: [105, 85], total: 190 },
        }),
      }),
    );
    expect(screen.getByText("Relative yield, % of the usual")).toBeTruthy();
    expect(screen.getByText("105%")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.getByText("Difference (recommended minus current)", { exact: false }).textContent).toContain("0%");
  });

  it("pending, unavailable (history) and a 404 offer the right text and Retry", async () => {
    await show(base({ status: "pending" }));
    expect(screen.getByText("The model is being run over past seasons…")).toBeTruthy();
    cleanup();
    await show(base({ status: "unavailable", reason: "history-missing" }));
    expect(screen.getByText(/no crop history/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open the field" })).toHaveLength(1);
    cleanup();
    const { ApiError } = await import("@/lib/api");
    await show(new ApiError({ type: "x/not-found", title: "Not found", status: 404 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
  });
});

describe("trustView rules", () => {
  it("thresholds", () => {
    expect(readFit({ n: 10, r: 0.7, mae: 1 })).toBe("close");
    expect(readFit({ n: 10, r: 0.69, mae: 1 })).toBe("loose");
    expect(readFit({ n: 10, r: 0.4, mae: 1 })).toBe("loose");
    expect(readFit({ n: 10, r: 0.39, mae: 1 })).toBe("none");
    expect(readFit({ n: 10, r: -0.9, mae: 1 })).toBe("opposite");
    expect(readFit({ n: 4, r: 0.99, mae: 1 })).toBe("few");
  });
  it("2022 direction", () => {
    expect(readCase2022(year(2022, { model: -20, county: 10 }))).toEqual({ kind: "opposite" });
    expect(readCase2022(year(2022, { model: -20, county: -35 }))).toEqual({ kind: "same", gap: 15, close: false });
    expect(readCase2022(year(2022, { model: -20, county: null }))).toEqual({ kind: "nocounty" });
  });
});
