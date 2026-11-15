import type { ClimateShift } from "@terrasight/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import uk from "../../../messages/uk.json";
import { ExploreClient, parseCoordinate, type OutlineItem } from "./ExploreClient";
import type { ExploreMapProps } from "./ExploreMap";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The map needs WebGL: a stand-in that exposes what the real one does (click a place, press a label).
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub(p: ExploreMapProps) {
      return (
        <div role="application" aria-label={p.label}>
          <button type="button" onClick={() => p.onPickPoint(-101.123456, 38.1)}>
            map-click
          </button>
          <span data-testid="drawn">{p.outlines.map((o) => o.name).join(",")}</span>
        </div>
      );
    },
}));

afterEach(cleanup);

const OUTLINES: OutlineItem[] = [
  {
    id: "pivot-12",
    name: "Pivot 12",
    place: "Finney County, Kansas, USA",
    areaHa: 47.9,
    centroid: { lon: -101.05, lat: 38.1 },
    geojsonUrl: "/api/public/outlines/pivot-12",
  },
];

const READY = {
  status: "ready",
  periods: { baseline: { from: 1981, to: 2000 }, recent: { from: 2006, to: 2025 } },
  hemisphere: "north",
  season: { from: "04-01", to: "09-30" },
  crop: null,
  flowering: { from: "06-01", to: "08-31", thresholdC: 35, verified: false, fallback: true, source: null },
  metrics: [
    {
      id: "seasonTemp",
      unit: "degC",
      baseline: 20,
      recent: 20.71,
      delta: 0.71,
      trend: { slopePerDecade: 0.3, pValue: 0.001, significant: true, years: 45 },
    },
  ],
  alpha: 0.05,
  skippedYears: [],
  source: { dataset: "NASA POWER", from: "1981-01-01", lastDate: "2026-11-10", cell: { lat: 38, lon: -101.25 }, resolutionKm: 55 },
  gpm: null,
} as unknown as ClimateShift;

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: `https://terrasight.app/problems/${code}`, title: "x", status }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

function mockFetch(climate: () => Promise<Response> | Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/public/outlines"))
      return json({ type: "Feature", properties: { id: "pivot-12" }, geometry: { type: "Polygon", coordinates: [] } });
    void init;
    return climate();
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calls = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([u]) => String(u) === "/api/public/climate-shift");

function view(locale: "en" | "uk" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={(locale === "en" ? en : uk) as never}>
      <ExploreClient outlines={OUTLINES} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe("parseCoordinate", () => {
  it("takes dot and comma decimals and the typographic minus; refuses the rest", () => {
    expect(parseCoordinate("38,10", 90)).toBe(38.1);
    expect(parseCoordinate("−101.05", 180)).toBe(-101.05);
    for (const bad of ["", "abc", "91", "1e3", "--1", "12.", "NaN"]) expect(parseCoordinate(bad, 90)).toBeNull();
  });
});

describe("Explore page", () => {
  it("starts idle, with the sign-in links and the privacy line", () => {
    mockFetch(() => json(READY));
    view();
    expect(screen.getByText(en.Explore.nothingYet)).toBeTruthy();
    expect(screen.getByRole("link", { name: en.Explore.signIn }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: en.Explore.create }).getAttribute("href")).toBe("/login?mode=signup");
    expect(screen.getByText(en.Explore.privacy)).toBeTruthy();
  });

  it("a map click loads the shift with the CSRF header, then says a rotation needs an outline", async () => {
    const f = mockFetch(() => json(READY));
    view();
    fireEvent.click(screen.getByText("map-click"));
    expect(screen.getByText(en.Explore.loading)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(en.Explore.pointNote, { exact: false })).toBeTruthy());
    const [, init] = calls(f)[0]!;
    expect((init as RequestInit).headers).toMatchObject({ "X-Requested-With": "XMLHttpRequest" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ lon: -101.1235, lat: 38.1 });
    expect(screen.getAllByRole("link", { name: en.Explore.pointNoteLink })).toHaveLength(2);
  });

  it("choosing a ready outline shows its centroid's shift and the sign-in note", async () => {
    const f = mockFetch(() => json(READY));
    view();
    await waitFor(() => expect(screen.getByTestId("drawn").textContent).toBe("Pivot 12"));
    fireEvent.click(screen.getByRole("button", { name: /Pivot 12 ·/ }));
    await waitFor(() => expect(screen.getByText(en.Explore.fieldNote, { exact: false })).toBeTruthy());
    expect(JSON.parse(calls(f)[0]![1]!.body as string)).toEqual({ lon: -101.05, lat: 38.1 });
    expect(screen.getByRole("button", { name: /Pivot 12 ·/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a failed source as failed, with Retry that asks again", async () => {
    let n = 0;
    const f = mockFetch(() => (n++ === 0 ? problem(500, "error") : json(READY)));
    view();
    fireEvent.click(screen.getByText("map-click"));
    await waitFor(() => expect(screen.getByText(en.Explore.failed)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: en.Explore.retry }));
    await waitFor(() => expect(screen.queryByText(en.Explore.failed)).toBeNull());
    expect(calls(f)).toHaveLength(2);
  });

  it("an unavailable result is the card's own unavailable state, not numbers", async () => {
    mockFetch(() => json({ ...READY, status: "unavailable", reason: "weather-missing", metrics: [], source: null }));
    view();
    fireEvent.click(screen.getByText("map-click"));
    await waitFor(() => expect(screen.getByText(en.Field.cs_unavail_title)).toBeTruthy());
  });

  it("429 shows the rate message; the daily cap shows its own and offers no retry", async () => {
    mockFetch(() => problem(429, "rate-limited"));
    view();
    fireEvent.click(screen.getByText("map-click"));
    await waitFor(() => expect(screen.getByText(en.Explore.rateLimited)).toBeTruthy());
    cleanup();

    mockFetch(() => problem(429, "daily-cap"));
    view();
    fireEvent.click(screen.getByText("map-click"));
    await waitFor(() => expect(screen.getByText(en.Explore.dailyCap)).toBeTruthy());
    expect(screen.queryByRole("button", { name: en.Explore.retry })).toBeNull();
  });

  it("the keyboard form validates, then loads the typed place", async () => {
    const f = mockFetch(() => json(READY));
    view();
    fireEvent.change(screen.getByLabelText(en.Explore.lat), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText(en.Explore.lon), { target: { value: "-101,05" } });
    fireEvent.click(screen.getByRole("button", { name: en.Explore.show }));
    expect(screen.getByText(en.Explore.errLat)).toBeTruthy();
    expect(calls(f)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(en.Explore.lat), { target: { value: "38,1" } });
    fireEvent.click(screen.getByRole("button", { name: en.Explore.show }));
    await waitFor(() => expect(calls(f)).toHaveLength(1));
    expect(JSON.parse(calls(f)[0]![1]!.body as string)).toEqual({ lon: -101.05, lat: 38.1 });
    expect(screen.queryByText(en.Explore.errLat)).toBeNull();
  });

  it("renders in Ukrainian", async () => {
    mockFetch(() => json(READY));
    view("uk");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(uk.Explore.title);
    expect(screen.getByText(uk.Explore.tag)).toBeTruthy();
    expect(screen.getByRole("link", { name: uk.Explore.create })).toBeTruthy();
    fireEvent.click(screen.getByText("map-click"));
    expect(screen.getByText(uk.Explore.loading)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(uk.Explore.pointNote, { exact: false })).toBeTruthy());
  });
});
