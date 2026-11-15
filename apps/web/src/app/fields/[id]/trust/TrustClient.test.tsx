import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Retrospective, TrustReport, TrustYear } from "@terrasight/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import design from "../../../../../messages/en.json";
import app from "../../../../messages/app.en.json";
import { TrustClient } from "./TrustClient";
import { cleanArea, parseCaveat, readCase2022, readFit } from "./trustView";

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
  modelFlat: false,
  dryland: null,
  ...over,
});

const dry = (over: Partial<NonNullable<TrustReport["dryland"]>> = {}): NonNullable<TrustReport["dryland"]> => ({
  area: "Kansas (state level, non-irrigated)",
  years: [2012, 2020, 2021, 2022].map((y) => year(y, { practice: "non-irrigated" })),
  fit: { n: 9, r: 0.81, mae: 7.2 },
  case2022: year(2022),
  ...over,
});

const flatYears = [2018, 2019, 2020, 2021, 2022].map((y) => year(y, { model: 0, county: y === 2022 ? -16.6 : 3 }));

const show = async (r: TrustReport | Error) => {
  report = r;
  render(wrap(<TrustClient workspaceId="w1" fieldId="f1" fieldName="North" />));
  await screen.findByRole("heading", { name: "How far can you trust this" });
  const busy = () =>
    screen.queryAllByLabelText("Loading the model-against-actual comparison").length +
    screen.queryAllByText("Loading the model-against-actual comparison").length;
  await waitFor(() => expect(busy()).toBe(0));
};

const heads2 = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("TrustClient", () => {
  it("opens with the verdict sentence, then the evidence line; the 2022 card is a collapsed row under it", async () => {
    await show(base({ years: [2018, 2019, 2020, 2021, 2022, 2023].map((y) => year(y, { miss: y === 2019 || y === 2021 })) }));
    const heads = heads2();
    expect(heads[0]).toBe("The short answer");
    expect(
      screen.getByText(
        "On this field the model followed the official yields closely: on average it was 5 points off. It missed 2 years by more than 20 points.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("r = 0.82 · mean error 4.5 points · 6 years")).toBeTruthy();
    expect(screen.getByText("The model follows it closely.")).toBeTruthy();
    expect(screen.getByText("Official yields: USDA NASS, Finney County, KS.")).toBeTruthy();
    // the 2022 row is a closed disclosure button, not a hero heading
    const row = screen.getByRole("button", { name: "2022, the drought year: model −30%, official −25%" });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(heads).not.toContain("2022: the record drought");
    // reading rules sit behind a disclosure
    expect(screen.getByRole("button", { name: "How we read these numbers" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/Close: r of 0\.7 or more/)).toBeTruthy();
    // order: verdict, chart, missed, not modelled
    const chartH = "Model, official yield and field greenness by year";
    expect(heads.indexOf("The short answer")).toBeLessThan(heads.indexOf(chartH));
    expect(heads.indexOf(chartH)).toBeLessThan(heads.indexOf("Years the model missed"));
    expect(heads.indexOf("Years the model missed")).toBeLessThan(heads.indexOf("What the model does not include"));
    const p = chartProps.mock.calls[0]![0] as { highlightYears: unknown[]; unitLabel: string; series: unknown[] };
    expect(p.highlightYears).toEqual([{ year: 2022, label: "2022" }]);
    expect(p.series).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Back to the field" }).getAttribute("href")).toBe("/fields/f1");
    expect(screen.getByRole("link", { name: "Go to the rotation" }).getAttribute("href")).toBe("/fields/f1/rotation");
  });

  it("2022 row says 'drought year' only when the official yield fell clearly; otherwise just 2022", async () => {
    await show(base({ case2022: year(2022, { model: 3, county: 4, ndvi: 1 }) }));
    expect(screen.getByRole("button", { name: "2022: model +3%, official yield +4%" })).toBeTruthy();
    expect(screen.queryByText(/drought year/)).toBeNull();
  });

  it("poor fit says so in plain words with caution; missed years carry reasons in words", async () => {
    await show(
      base({
        vsCounty: { n: 8, r: 0.12, mae: 22.3 },
        years: [
          year(2019, { model: 30, county: -10, miss: true, reason: "heat" }),
          year(2021, { model: 5, county: 40, miss: true, reason: "unknown" }),
        ],
      }),
    );
    expect(
      screen.getByText(/did not follow the official yields well: on average it was 22 points off\. Treat its yield numbers with caution/),
    ).toBeTruthy();
    expect(screen.getByText("r = 0.12 · mean error 22.3 points · 8 years")).toBeTruthy();
    expect(screen.getByText("2019 · Corn")).toBeTruthy();
    expect(screen.getByText("model +30% · official yield −10%")).toBeTruthy();
    expect(screen.getByText(/does not include heat damage/)).toBeTruthy();
    expect(screen.getByText("We do not know why.")).toBeTruthy();
    expect((chartProps.mock.calls[0]![0] as { missYears: number[] }).missYears).toEqual([2019, 2021]);
  });

  it("too few years: no error number in the sentence", async () => {
    await show(base({ vsCounty: { n: 3, r: null, mae: 7 } }));
    expect(screen.getByText(/Fewer than 5 years have both a model value and an official yield/)).toBeTruthy();
    expect(screen.getByText("Too few years to say.")).toBeTruthy();
  });

  it("no official yields: says it cannot check and names the satellite check", async () => {
    await show(base({ vsCounty: null, actual: { kind: "nass", connected: false, area: null, verified: false } }));
    expect(
      screen.getByText("Official yields are not connected, so the comparison uses satellite greenness only."),
    ).toBeTruthy();
    expect(screen.getByText(/We cannot check this field against official yields/)).toBeTruthy();
    expect(screen.getByText("There are no official yields, so missed years cannot be listed.")).toBeTruthy();
  });

  it("Ukraine: what was compared, why no official check, soft wording for a weak satellite match", async () => {
    await show(
      base({
        actual: {
          kind: "derzhstat",
          connected: true,
          area: "Poltava oblast (State Statistics Service, unverified)",
          verified: false,
        },
        case2022: year(2022, { model: -5, county: 2, ndvi: 3 }),
        vsCounty: { n: 0, r: null, mae: null },
        vsNdvi: { n: 18, r: 0.25, mae: 11 },
      }),
    );
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/do not exist for single fields, and the oblast averages we have are not verified/);
    expect(text).toMatch(/satellite greenness only, and it does not clearly agree with the model/);
    expect(text).toMatch(/not a sign that the model is wrong/);
    expect(text).not.toMatch(/does not follow it/);
    expect(text).not.toMatch(/record drought/);
    expect(screen.getByText("Greenness does not clearly agree.")).toBeTruthy();
    expect(text).toContain("Poltava oblast (State Statistics Service, not verified)");
    // no 2022 row for a field without a verified official yield
    expect(screen.queryByRole("button", { name: /^2022/ })).toBeNull();
    const p = chartProps.mock.calls[0]![0] as { series: Array<{ label: string }> };
    expect(p.series[1]!.label).toBe("Oblast (Derzhstat, not verified)");
  });

  it("no 2022 case: the verdict still comes first and there is no 2022 row", async () => {
    await show(base({ case2022: null }));
    expect(heads2()[0]).toBe("The short answer");
    expect(screen.queryByRole("button", { name: /^2022/ })).toBeNull();
  });

  it("raw caveat codes and crop ids never reach the screen; unknown codes are hidden", async () => {
    await show(
      base({
        caveats: [
          "practice-all-used:corn",
          "state-level-yields:winter_wheat",
          "unverified-crop-parameters:winter_wheat",
          "single-year-crop:corn",
          "second-crop-ignored",
          "no-simulator-parameters:triticale",
          "short-county-series:corn",
          "estimated-crop-history",
          "some-new-code:corn",
        ],
        actual: {
          kind: "nass",
          connected: true,
          area: "winter_wheat: Kansas (state level, irrigated); corn: Finney County, KS (all practices)",
          verified: true,
        },
      }),
    );
    expect(
      screen.getByText("Corn: the official yields mix irrigated and non-irrigated fields, so they are a rough guide."),
    ).toBeTruthy();
    expect(screen.getByText("This crop: the official yields are state averages, not your county.")).toBeTruthy();
    expect(screen.getByText(/Only the first crop of the year is modelled/)).toBeTruthy();
    expect(screen.getByText(/The crop history is estimated from satellite images/)).toBeTruthy();
    expect(screen.getByText(/This crop: the model has no parameters for it/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(
      /practice-all-used|state-level-yields|single-year-crop|second-crop-ignored|some-new-code|winter_wheat|estimated-crop-history/,
    );
    expect(text).toContain(
      "Official yields: USDA NASS, This crop: Kansas (state level, irrigated); Corn: Finney County, KS (all practices).",
    );
  });

  it("retrospective in money: a verdict sentence first, the table behind a disclosure", async () => {
    await show(base({ retrospective: retro() }));
    expect(screen.getByRole("heading", { name: "If this field had switched in 2018" })).toBeTruthy();
    expect(
      screen.getByText("Over 2 seasons the recommended rotation would have earned $10 per hectare more than the current one."),
    ).toBeTruthy();
    expect(
      screen.getByText("At today's prices: two simulations on the real weather of those years, not what the field earned."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Season by season" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByText("$620").length).toBeGreaterThan(0);
  });

  it("retrospective in estimate mode: a verdict sentence from averages, no total of percentages", async () => {
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
    expect(
      screen.getByText("Over 2 seasons the model gives both rotations about the same yield: about 95% against 95% of the usual."),
    ).toBeTruthy();
    expect(screen.getByText("Relative yield, % of the usual")).toBeTruthy();
    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.getByText("Average")).toBeTruthy();
    expect(screen.queryByText("190%")).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("retrospective where the recommendation is lower says why it looks back", async () => {
    await show(
      base({
        retrospective: retro({
          mode: "agronomy",
          currency: null,
          current: { id: "a", bySeason: [100, 100], total: 200 },
          recommended: { id: "b", bySeason: [90, 90], total: 180 },
        }),
      }),
    );
    expect(screen.getByText(/lower yield than the current one: about 90% against 100%/)).toBeTruthy();
    expect(screen.getByText(/This looks back at weather that has already happened/)).toBeTruthy();
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

describe("irrigated field: flat model", () => {
  const flat = (over: Partial<TrustReport> = {}) =>
    base({
      modelFlat: true,
      years: flatYears,
      vsCounty: { n: 5, r: null, mae: 4.2 },
      vsNdvi: { n: 5, r: null, mae: 5 },
      case2022: year(2022, { model: 0, county: -16.6, ndvi: -10 }),
      ...over,
    });

  it("keeps the plain notice first; the flat cards are behind one disclosure", async () => {
    await show(flat());
    const heads = heads2();
    expect(heads[0]).toBe("The model cannot be checked against yields for this field");
    expect(heads).not.toContain("The short answer");
    expect(screen.getByText(/the model shows the same yield every year: it assumes irrigation always covers/)).toBeTruthy();
    expect(screen.getByText(/for example −17% in 2022 against a normal year/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Show the flat comparison/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(region.querySelector('[data-testid="chart"]')).toBeTruthy();
    expect(region.textContent).toMatch(/The model shows no change; the official yield was 17% below a normal year\./);
    expect(region.textContent).not.toMatch(/moved the same way/);
    expect(region.querySelectorAll("h3").length).toBeGreaterThan(2);
    expect(screen.getAllByText("Cannot be compared: the model does not vary.")).toHaveLength(2);
    expect(screen.queryByText("Too few years to say.")).toBeNull();
  });

  it("without a 2022 county value the example is the largest county deviation; without any it is omitted", async () => {
    const ys = [2018, 2019, 2020, 2021].map((y, i) => year(y, { model: 0, county: [3, -12, 5, 2][i]! }));
    await show(flat({ years: ys, case2022: year(2022, { model: 0, county: null }) }));
    expect(screen.getByText(/for example −12% in 2019 against a normal year/)).toBeTruthy();
    expect(screen.getByText(/There is no official yield for 2022/)).toBeTruthy();
    cleanup();
    await show(flat({ years: ys.map((y) => ({ ...y, county: null })), case2022: null }));
    expect(screen.getByText(/Real yields still moved\. So the model/)).toBeTruthy();
    expect(screen.queryByText(/for example/)).toBeNull();
  });

  it("too few years stays 'too few years' even when the model is flat", async () => {
    await show(flat({ vsCounty: { n: 3, r: null, mae: 4 } }));
    expect(screen.getByText("Too few years to say.")).toBeTruthy();
  });

  it("dryland good fit: the main content after the notice, area, fit line, chart series, missed list", async () => {
    await show(
      flat({
        dryland: dry({
          years: [
            year(2012, { model: -40, county: -35, practice: "non-irrigated" }),
            year(2019, { model: 30, county: -10, practice: "non-irrigated", miss: true, reason: "unknown" }),
            year(2022, { model: -20, county: -25, practice: "non-irrigated" }),
          ],
        }),
      }),
    );
    const heads = heads2();
    expect(heads[1]).toBe("The same model without irrigation");
    expect(screen.getByText(/compared it with non-irrigated yields of Kansas \(state level, non-irrigated\)\./)).toBeTruthy();
    expect(screen.getByText(/it is not this field's result/)).toBeTruthy();
    expect(screen.getByText("r = 0.81 · mean error 7.2 points · 9 years")).toBeTruthy();
    expect(screen.getByText("The model follows it closely.")).toBeTruthy();
    const calls = chartProps.mock.calls.map(
      (c) =>
        c[0] as {
          series: Array<{ id: string; label: string }>;
          highlightYears: Array<{ year: number }>;
          missYears: number[];
        },
    );
    const d = calls.find((c) => c.series.length === 2)!;
    expect(d.series.map((x) => x.label)).toEqual(["Model without irrigation", "Non-irrigated yields"]);
    expect(d.highlightYears.map((h) => h.year)).toEqual([2012, 2022]);
    expect(d.missYears).toEqual([2019]);
    expect(screen.getByRole("heading", { name: "Years the model without irrigation missed" })).toBeTruthy();
  });

  it("dryland poor fit says so in the same words", async () => {
    await show(flat({ dryland: dry({ fit: { n: 9, r: 0.1, mae: 25 } }) }));
    expect(screen.getByText("r = 0.10 · mean error 25.0 points · 9 years")).toBeTruthy();
    expect(screen.getByText("The model does not follow it.")).toBeTruthy();
  });

  it("dryland absent: no such section", async () => {
    await show(flat());
    expect(screen.queryByRole("heading", { name: "The same model without irrigation" })).toBeNull();
  });
});

describe("rainfed field", () => {
  it("shows neither the flat note nor a dryland section", async () => {
    await show(base());
    expect(screen.queryByText("The model cannot be checked against yields for this field")).toBeNull();
    expect(screen.queryByRole("heading", { name: "The same model without irrigation" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show the flat comparison/ })).toBeNull();
    expect(chartProps).toHaveBeenCalledTimes(1);
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
    expect(readFit({ n: 8, r: null, mae: 1 })).toBe("few");
    expect(readFit({ n: 8, r: null, mae: 1 }, true)).toBe("flat");
    expect(readFit({ n: 3, r: null, mae: 1 }, true)).toBe("few");
  });
  it("2022 direction", () => {
    expect(readCase2022(year(2022, { model: -20, county: 10 }))).toEqual({ kind: "opposite" });
    expect(readCase2022(year(2022, { model: -20, county: -35 }))).toEqual({ kind: "same", gap: 15, close: false });
    expect(readCase2022(year(2022, { model: -20, county: null }))).toEqual({ kind: "nocounty" });
  });
  it("caveat codes: known parsed, unknown dropped", () => {
    expect(parseCaveat("state-level-yields:winter_wheat")).toEqual({ code: "state-level-yields", crop: "winter_wheat" });
    expect(parseCaveat("second-crop-ignored")).toEqual({ code: "second-crop-ignored", crop: null });
    expect(parseCaveat("whatever:corn")).toBeNull();
  });
  it("source line: crop ids to names, bracket words translated", () => {
    expect(
      cleanArea(
        "winter_wheat, corn: Kansas (state level, irrigated); Finney County, KS (all practices)",
        (c) => c.toUpperCase(),
        (k) => (k === "irrigated" ? "IRR" : null),
      ),
    ).toBe("WINTER_WHEAT, CORN: Kansas (state level, IRR); Finney County, KS (all practices)");
  });
});
