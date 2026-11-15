import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../../messages/app.en.json";
import messages from "../../../../messages/en.json";
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
vi.mock("@/lib/useActionToast", () => ({ useActionToast: () => ({ fail: vi.fn() }) }));

const history: PlannerHistory = {
  cropNames: { wheat_winter: { en: "Winter wheat", uk: "Озима пшениця" } },
  regionCrops: ["wheat_winter"],
  seasons: [],
};
const today = todayIso();
const r = (value: string | null, source: string) => ({ value, source });

function setup(suitability?: PlannerHistory["suitability"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={{ App: app.App, Field: messages.Field }}>
      <QueryClientProvider client={client}>
        <SeasonPlanner base="/b" canEdit history={{ ...history, suitability }} workspaceId="w" fieldId="f" />
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

describe("SeasonPlanner on land that is not suitable", () => {
  const reason = {
    code: "slope_steep",
    level: "unsuitable" as const,
    value: 31,
    threshold: 25,
    unit: "%",
    source: "FAO: Land evaluation",
    sourceUrl: "https://example.org",
    verified: true,
    mvpDefault: true,
  };
  const planning = () => {
    record = {
      season: 2027,
      crop: r(null, "unknown"),
      sowingDate: r(null, "unknown"),
      emergenceDate: r(null, "unknown"),
      tillage: r(null, "unknown"),
      missing: [],
    };
    suggestion = sug(null);
  };

  it("switches the crop choice off, lists the reasons and offers the override; no suggestion is requested", async () => {
    planning();
    setup({ status: "unsuitable", reasons: [reason], blocked: true, override: null });
    expect(await screen.findByText("Crop choice is off for this field")).toBeTruthy();
    expect(screen.getByText(/average slope is 31%, steeper than 25%/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /still cropland/ })).toBeTruthy();
    expect(screen.queryByLabelText(/What will you grow/)).toBeNull();
    expect(calls.some((c) => c.path.includes("/suggest"))).toBe(false);
  });

  it("override: the planner works normally again", async () => {
    planning();
    setup({
      status: "unsuitable",
      reasons: [reason],
      blocked: false,
      override: { userId: "u", userName: "Olena", at: "2026-11-15T10:00:00Z" },
    });
    expect(await screen.findByText(/What will you grow in season/)).toBeTruthy();
    expect(screen.queryByText("Crop choice is off for this field")).toBeNull();
  });

  it("limited land only warns: the crop choice stays", async () => {
    planning();
    setup({ status: "limited", reasons: [{ ...reason, level: "limited", value: 18, threshold: 15 }] });
    expect(await screen.findByText(/This land has limits for crops/)).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
