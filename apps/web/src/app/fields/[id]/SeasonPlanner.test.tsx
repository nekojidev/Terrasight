import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../../messages/app.en.json";
import { SeasonPlanner, type PlannerHistory } from "./SeasonPlanner";
import { addDays, todayIso } from "./seasonStage";

const calls: Array<{ path: string; body?: unknown }> = [];
let record: Record<string, unknown>;
let suggestion: Record<string, unknown>;

vi.mock("@/lib/api", () => ({
  api: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
    calls.push({ path, body: opts?.body });
    if (opts?.method === "PUT") return record;
    if (path.includes("/suggest")) return suggestion;
    return record;
  }),
}));
vi.mock("@/components/useReportError", () => ({ useReportError: () => vi.fn() }));

const history: PlannerHistory = {
  cropNames: { wheat_winter: { en: "Winter wheat", uk: "Озима пшениця" } },
  regionCrops: ["wheat_winter"],
  seasons: [],
};
const today = todayIso();
const r = (value: string | null, source: string) => ({ value, source });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={{ App: app.App }}>
      <QueryClientProvider client={client}>
        <SeasonPlanner base="/b" canEdit history={history} workspaceId="w" fieldId="f" />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const sug = (emergence: string | null) => ({
  season: 2027,
  crop: "wheat_winter",
  sowing: {
    window: { from: addDays(today, -5), to: addDays(today, 20) },
    best: addDays(today, 2),
    bestBasis: "typical",
    source: null,
    verified: false,
    status: "open",
    daysLeft: 20,
  },
  emergence: emergence
    ? { date: emergence, method: "gdd-forecast", gdd: 120, source: null, verified: false }
    : null,
  tillage: null,
});

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("SeasonPlanner stages", () => {
  it("planning: asks for the crop and sowing, shows emergence read-only, never as an input", async () => {
    record = {
      season: 2027,
      crop: r("wheat_winter", "plan"),
      sowingDate: r(addDays(today, 2), "regional"),
      emergenceDate: r(null, "unknown"),
      tillage: r(null, "unknown"),
      missing: [],
    };
    suggestion = sug(addDays(today, 14));
    setup();
    expect(await screen.findByText(/What will you grow in season/)).toBeTruthy();
    await screen.findByLabelText("Planned sowing date");
    expect(screen.getByText(/Expected emergence: ≈/)).toBeTruthy();
    expect(screen.queryByLabelText(/Emerged on|Emergence date/)).toBeNull();
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as sown" })).toBeTruthy();
  });

  it("Mark as sown stores today (within 7 days of the plan) as a confirmed date", async () => {
    record = {
      season: 2027,
      crop: r("wheat_winter", "plan"),
      sowingDate: r(addDays(today, 2), "regional"),
      emergenceDate: r(null, "unknown"),
      tillage: r(null, "unknown"),
      missing: [],
    };
    suggestion = sug(addDays(today, 14));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mark as sown" }));
    const input = (await screen.findByLabelText("Sown on")) as HTMLInputElement;
    expect(input.value).toBe(today);
    fireEvent.click(screen.getByRole("button", { name: "Confirm sowing" }));
    await waitFor(() => expect(calls.some((c) => c.body)).toBe(true));
    const put = calls.find((c) => c.body)!.body as { sowingDate: string; sources: Record<string, string> };
    expect(put.sowingDate).toBe(today);
    expect(put.sources.sowingDate).toBeUndefined();
  });

  it("sown: asks about emergence near the expected date, Not yet hides it", async () => {
    record = {
      season: 2027,
      crop: r("wheat_winter", "confirmed"),
      sowingDate: r(addDays(today, -10), "confirmed"),
      emergenceDate: r(null, "unknown"),
      tillage: r(null, "unknown"),
      missing: [],
    };
    suggestion = sug(addDays(today, 1));
    setup();
    expect(await screen.findByText("Have the seedlings come up?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Yes, on/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    await waitFor(() => expect(screen.queryByText("Have the seedlings come up?")).toBeNull());
    expect(localStorage.getItem("ts-emergence-snooze:f:2027")).toBe(addDays(today, 3));
  });

  it("sown: no prompt while emergence is still far off", async () => {
    record = {
      season: 2027,
      crop: r("wheat_winter", "confirmed"),
      sowingDate: r(addDays(today, -1), "confirmed"),
      emergenceDate: r(null, "unknown"),
      tillage: r(null, "unknown"),
      missing: [],
    };
    suggestion = sug(addDays(today, 12));
    setup();
    expect(await screen.findByText("Sown")).toBeTruthy();
    await screen.findByText(/≈/);
    expect(screen.queryByText("Have the seedlings come up?")).toBeNull();
  });
});
