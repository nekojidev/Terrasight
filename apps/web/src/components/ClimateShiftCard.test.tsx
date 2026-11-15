import type { ClimateMetric, ClimateShift } from "@terrasight/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { ClimateShiftCard, pickHeadlineMetrics, type ClimateShiftCardProps } from "./ClimateShiftCard";
import { ModelVsActualChart } from "./ModelVsActualChart";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function wrap(ui: ReactNode, messages: typeof en | typeof uk = en, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages as never}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const trend = (significant: boolean, slope: number | null = 0.3, p = significant ? 0.01 : 0.4) => ({
  slopePerDecade: slope,
  pValue: p,
  significant,
  years: 45,
});
const metric = (over: Partial<ClimateMetric> & Pick<ClimateMetric, "id" | "unit">): ClimateMetric => ({
  baseline: 10,
  recent: 11,
  delta: 1,
  trend: trend(false),
  ...over,
});

function shift(over: Partial<ClimateShift> = {}): ClimateShift {
  return {
    status: "ready",
    periods: { baseline: { from: 1981, to: 2000 }, recent: { from: 2006, to: 2025 } },
    hemisphere: "north",
    season: { from: "04-01", to: "09-30" },
    crop: "corn",
    flowering: { from: "07-01", to: "07-31", thresholdC: 35, verified: false, fallback: true, source: null },
    metrics: [
      metric({ id: "seasonTemp", unit: "degC", baseline: 18.2, recent: 19.6, delta: 1.4, trend: trend(true, 0.4, 0.001) }),
      metric({ id: "hotDaysFlowering", unit: "days", baseline: 3, recent: 5.5, delta: 2.5, trend: trend(true, 0.6, 0.02) }),
      metric({ id: "seasonPrecip", unit: "mm", baseline: 400, recent: 380, delta: -20, trend: trend(false, -3) }),
      metric({ id: "longestDrySpell", unit: "days", baseline: 12, recent: 14, delta: 2, trend: trend(false, 0.5) }),
      metric({ id: "gdd", unit: "degDays", baseline: 1800, recent: 1900, delta: 100, trend: trend(false, 20) }),
      metric({ id: "lastSpringFrost", unit: "dayOfYear", baseline: 132, recent: 124, delta: -8, trend: trend(false, -2) }),
      metric({ id: "firstAutumnFrost", unit: "dayOfYear", baseline: 280, recent: 285, delta: 5, trend: trend(false, 1) }),
      metric({ id: "frostFreeDays", unit: "days", baseline: 150, recent: 160, delta: 10, trend: trend(false, 2) }),
    ],
    alpha: 0.05,
    skippedYears: [],
    source: {
      dataset: "NASA POWER",
      from: "1981-01-01",
      lastDate: "2025-10-30",
      cell: { lat: 37.9, lon: -100.9 },
      resolutionKm: 55,
    },
    gpm: null,
    ...over,
  };
}

const base: ClimateShiftCardProps = { data: undefined, isLoading: false, isError: false, onRetry: () => {} };
const card = (over: Partial<ClimateShiftCardProps> = {}) => <ClimateShiftCard {...base} {...over} />;

describe("ClimateShiftCard", () => {
  it("ready with mixed significance: headline states only clear changes, every metric keeps its words", () => {
    wrap(card({ data: shift(), trustHref: "/fields/f1/trust" }));
    const h = screen.getByRole("heading", { level: 2 });
    expect(h.textContent).toBe(
      "The growing season here is 1.4°C warmer than in 1981–2000. Hot days at flowering rise by 2.5 days per season.",
    );
    expect(h.textContent).not.toMatch(/rain|dry|frost/i);
    expect(screen.getByText(/Field shift · NASA POWER 1981–2025/i)).toBeTruthy();
    const list = screen.getByRole("list", { name: /Climate metrics/ });
    expect(within(list).getAllByText("clear trend")).toHaveLength(2);
    expect(within(list).getAllByText("no clear trend")).toHaveLength(6);
    // true minus sign, date shift in words
    expect(within(list).getByText("−20 mm")).toBeTruthy();
    expect(within(list).getByText("8 days earlier")).toBeTruthy();
    expect(within(list).getByText("May 12")).toBeTruthy();
    // footer and link are always there
    expect(screen.getByText(/grid of about 55 km: neighbouring fields share these numbers/)).toBeTruthy();
    expect(screen.getByText(/not a forecast/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /How far can you trust this/ }).getAttribute("href")).toBe("/fields/f1/trust");
  });

  it("nothing significant: says so plainly and names no change", () => {
    const d = shift({ metrics: shift().metrics.map((m) => ({ ...m, trend: trend(false) })) });
    wrap(card({ data: d }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("No clear climate trend at this place in 1981–2025");
    expect(screen.queryByText("clear trend")).toBeNull();
  });

  it("headline never uses a metric whose slope contradicts the period difference", () => {
    const ms = [metric({ id: "seasonTemp", unit: "degC", delta: 1, trend: trend(true, -0.2) })];
    expect(pickHeadlineMetrics(ms, () => true)).toEqual([]);
  });

  it("pending shows the skeleton and the waiting line", () => {
    wrap(card({ data: { ...shift(), status: "pending", metrics: [] }, isLoading: true }));
    expect(screen.getByText(/Reading 45 years of NASA weather for this place… usually under half a minute/)).toBeTruthy();
    expect(screen.queryByText(/NASA POWER is a grid/)).toBeNull();
  });

  it("unavailable and a failed request show what is missing and Retry", () => {
    const onRetry = vi.fn();
    wrap(card({ data: { ...shift(), status: "unavailable", reason: "too-few-years", metrics: [] }, onRetry }));
    expect(screen.getByText(/too few years of weather/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    wrap(card({ isError: true, onRetry }));
    expect(screen.getByText("The climate shift is not available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("imperial: a temperature difference is scaled by 1.8, not offset by 32; rain in inches", () => {
    const d = shift({
      metrics: [
        metric({ id: "seasonTemp", unit: "degC", baseline: 10, recent: 11, delta: 1, trend: trend(true, 0.4, 0.001) }),
        metric({ id: "seasonPrecip", unit: "mm", baseline: 254, recent: 279.4, delta: 25.4, trend: trend(false, 1) }),
      ],
    });
    wrap(card({ data: d, country: "US" }));
    const list = screen.getByRole("list", { name: /Climate metrics/ });
    expect(within(list).getByText("+1.8°F")).toBeTruthy();
    expect(within(list).getByText("50°F")).toBeTruthy(); // 10 °C absolute = 50 °F
    expect(list.textContent).not.toMatch(/33\.8/);
    expect(within(list).getByText(/^\+1(\.00)?\s?in$/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("1.8°F warmer");
  });

  it("frost metric: years without frost are counted, never shown as 0", () => {
    const d = shift({
      metrics: [
        metric({
          id: "lastSpringFrost",
          unit: "dayOfYear",
          baseline: null,
          recent: 70,
          delta: null,
          yearsWithout: { baseline: 20, recent: 3 },
          trend: trend(false, null, null as never),
        }),
      ],
    });
    wrap(card({ data: d }));
    expect(screen.getByText("No frost in 20 of 20 years")).toBeTruthy();
    expect(screen.getByText("No frost in 3 of 20 years", { exact: false })).toBeTruthy();
    expect(screen.getByText("No comparison possible")).toBeTruthy();
    expect(screen.queryByText("Jan 0")).toBeNull();
  });

  it("GPM line follows `agree`; unavailable says so", () => {
    const g = (agree: boolean | null) => ({
      status: "ready" as const,
      early: { from: 2001, to: 2012 },
      late: { from: 2013, to: 2024 },
      powerChangePct: 4.2,
      imergChangePct: -3,
      agree,
      lastDate: "2025-10-01",
    });
    wrap(card({ data: shift({ gpm: g(true) }) }));
    expect(screen.getByText(/in the same direction: POWER \+4\.2\s%, IMERG −3\s%/)).toBeTruthy();
    cleanup();
    wrap(card({ data: shift({ gpm: g(false) }) }));
    expect(screen.getByText(/in the opposite direction/)).toBeTruthy();
    cleanup();
    wrap(card({ data: shift({ gpm: { ...g(null), status: "unavailable" } }) }));
    expect(screen.getByText("The GPM IMERG check is not available right now.")).toBeTruthy();
  });

  it("compact shows the strongest clear changes and the full table behind a disclosure", () => {
    wrap(card({ data: shift(), compact: true }));
    // only two clear changes in this data: two takeaways, the table lives behind "All metrics"
    const take = screen.getByRole("list", { name: "Main changes" });
    expect(within(take).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /All metrics/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByRole("list", { name: /Climate metrics/, hidden: true })).toHaveLength(1);
  });

  it("compact picks exactly 3 plain takeaways: frost date, season length, heat", () => {
    const d = shift();
    const sig = new Set(["firstAutumnFrost", "frostFreeDays", "seasonTemp", "hotDaysFlowering"]);
    d.metrics = d.metrics.map((m) => (sig.has(m.id) ? { ...m, trend: trend(true, Math.sign(m.delta ?? 1) * 3, 0.01) } : m));
    wrap(card({ data: d, compact: true }));
    const take = screen.getByRole("list", { name: "Main changes" });
    const items = within(take).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toMatch(/first autumn frost/i);
    expect(items[1]!.textContent).toMatch(/frost-free/i);
    expect(items[2]!.textContent).toMatch(/growing season/i);
    expect(take.textContent).toMatch(/every 10 years/);
  });

  it("picks fixes the takeaways, and a metric without a clear trend is never shown as a change", () => {
    wrap(card({ data: shift(), compact: true, picks: ["hotDaysFlowering", "seasonPrecip"] }));
    const items = within(screen.getByRole("list", { name: "Main changes" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toMatch(/Hot days at flowering/);
  });

  it("collapsed is one row that names the first takeaway and opens the compact card", () => {
    wrap(card({ data: shift(), compact: true, collapsed: true }));
    const row = screen.getByRole("button", { name: /How this field's climate has changed: /i });
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders in Ukrainian", () => {
    wrap(card({ data: shift() }), uk, "uk");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Вегетаційний сезон тут на 1,4 °C теплішим");
    expect(screen.getAllByText("чіткого тренду немає").length).toBeGreaterThan(0);
  });
});

describe("ModelVsActualChart", () => {
  const props = {
    years: [2018, 2019, 2020, 2021, 2022],
    series: [
      { id: "model", label: "Model", values: [-2, 3, null, 1, -30] as Array<number | null> },
      { id: "county", label: "County yield", values: [-1, 2, 1, 0, -25] as Array<number | null> },
      { id: "ndvi", label: "NDVI", values: [0, 1, 1, null, -10] as Array<number | null> },
    ],
    unitLabel: "% against a typical year",
    highlightYears: [{ year: 2022, label: "2022 drought" }],
    missYears: [2019],
    ariaLabel: "Model against actual by year",
    tableCaption: "Model against actual, values by year",
  };

  it("draws gaps, a zero line, a labelled band, a miss ring and a legend row instead of end labels", () => {
    const { container } = wrap(<ModelVsActualChart {...props} />);
    expect(screen.getByRole("img", { name: props.ariaLabel })).toBeTruthy();
    expect(screen.getByText("2022 drought")).toBeTruthy();
    expect(screen.getAllByTestId("miss-ring")).toHaveLength(1);
    expect(screen.getByText(/Ring: the model missed this year \(2019\)/)).toBeTruthy();
    // model has a gap in 2020: two runs, the first with 2 points, the second a lone marker (no line)
    expect(container.querySelectorAll("polyline").length).toBe(4);
    expect(screen.getByRole("list", { name: "Series" }).textContent).toContain("Model");
    expect(container.querySelectorAll("circle, rect, polygon").length).toBeGreaterThan(10);
  });

  it("table view lists every number and marks missing years", () => {
    wrap(<ModelVsActualChart {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getAllByText("no data")).toHaveLength(2);
    expect(within(table).getByText("-30")).toBeTruthy();
    expect(within(table).getByText("2022 drought")).toBeTruthy();
  });
});
