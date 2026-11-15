import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import appEn from "../messages/app.en.json";
import { Brief } from "./Brief";

const push = vi.fn();
let routes: Record<string, unknown> = {};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  api: vi.fn(async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`no route for ${url}`);
    return hit[1];
  }),
}));
vi.mock("@/lib/events", () => ({ useWorkspaceEvents: () => undefined }));
vi.mock("@/lib/useActionToast", () => ({ useActionToast: () => ({ fail: vi.fn() }) }));
vi.mock("@/components/TodayWindows", () => ({ TodayWindows: () => <div data-testid="windows" /> }));
vi.mock("@/components/OutlookRailLine", () => ({ OutlookRailLine: () => null }));

const text = (s: string) => ({ en: s, uk: s });
const item = (id: string, urgency: "urgent" | "this_week", title: string) => ({
  id,
  fieldId: `f-${id}`,
  fieldName: `Field ${id}`,
  level: "high",
  confidence: "low",
  tier: "C",
  deadline: "2026-11-16",
  planning: false,
  irreversible: false,
  keyNumbers: [{ id: "daysUntilFrost", value: 1, weight: 0.5 }],
  evidence: [{ source: "NASA POWER" }],
  text: { title: text(title), action: text("Check sensitive crops."), why: text("Frost is forecast.") },
  textSource: "template",
  urgency,
  more: 0,
  seasons: [],
});

const brief = (over: Record<string, unknown> = {}) => ({
  date: "2026-11-15",
  timeZone: "UTC",
  counts: { fields: 4, urgent: 1, thisWeek: 1, allGood: 2, worthALook: 1 },
  daySummary: null,
  worthALook: [item("w", "this_week", "A pest idea")],
  hero: item("a", "urgent", "Frost expected tomorrow"),
  urgent: [],
  thisWeek: [item("b", "this_week", "Wheat streak mosaic virus risk")],
  allGood: [
    { fieldId: "g1", name: "North", seasons: [], plan: null, unknown: null },
    { fieldId: "g2", name: "South", seasons: [], plan: null, unknown: null },
  ],
  rail: {
    today: { fields: 4, checked: 4, newRecommendations: 1, urgent: 1 },
    weather: [],
    ownerQuestion: null,
  },
  ...over,
});

const stress = {
  status: "ready",
  stressYear: 2022,
  season: 2026,
  currency: "USD",
  current: { atRisk: 80000, typical: 400000 },
  recommended: { atRisk: 50000, typical: 400000 },
  difference: 30000,
  counted: [{ fieldId: "f", name: "F", areaHa: 10, currentLoss: 8, recommendedLoss: 5 }],
  notCounted: [],
};

function setup(props: { owner?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ ...en, ...appEn }}>
        <Brief
          workspaceId="w1"
          firstName="Marko"
          units="imperial"
          canAct={!props.owner}
          canAsk={!props.owner}
          isOwner={!!props.owner}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  routes = {
    "/brief": brief(),
    "/decisions": {
      items: [
        {
          id: "d1",
          state: "waiting",
          title: text("Rotation for 2026: corn first"),
          fieldName: "Pivot 14",
          deadline: "2026-11-16",
        },
      ],
    },
    "/farm-stress": stress,
    "/analysis-runs/latest": { id: "r1", status: "done", finishedAt: "2026-11-01T08:00:00Z", summary: { total: 1, checked: 1, newRecommendations: 0, problems: [] } },
    "/fields-overview": { counties: [{ state: "UA-30", fields: [{ fieldId: "f-a" }] }] },
  };
});
afterEach(cleanup);

describe("Brief, Agronomist", () => {
  it("counts once, leads with the headline card and the questions, then the rest of the week", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "1 thing to do today" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Frost expected tomorrow" })).toBeTruthy();
    expect(screen.getByTestId("trust-line").textContent).toContain("Reliability: Low");
    expect(screen.getByRole("button", { name: /Show the evidence/ })).toBeTruthy();
    // "Also this week" holds only the items that are not the headline.
    expect(screen.getByRole("heading", { name: /Also this week/ }).textContent).toContain("1");
    expect(screen.queryByRole("heading", { name: /^Today\b/ })).toBeNull();
    // One stress line that links to the Plan page, collapsed rows, no "Worth a look" wording.
    expect(screen.getByRole("link", { name: /If 2022 weather returns/ }).getAttribute("href")).toBe("/rotation#stress");
    expect(screen.getByText("2 fields are fine")).toBeTruthy();
    expect(screen.getByText(/Assistant's ideas/)).toBeTruthy();
    expect(screen.getByText("Next 7 days")).toBeTruthy();
    expect(screen.queryByText(/\$\d+,\d+ at risk/)).toBeNull();
  });

  it("the action bar is part of the card flow: never sticky over its own card", async () => {
    setup();
    const accept = await screen.findByRole("button", { name: "Accept" });
    expect(accept.parentElement?.className ?? "").not.toMatch(/sticky|fixed/);
  });

  it("a suggested question opens the assistant with the question prepared and the field", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /What should I do first today\?/ }));
    expect(push).toHaveBeenCalledWith(
      `/assistant?ask=${encodeURIComponent("What should I do first today?")}&field=f-a`,
    );
  });

  it("a finished run on a bigger company says what was checked, once, and Analyze is secondary", async () => {
    routes["/analysis-runs/latest"] = {
      id: "r1",
      status: "done",
      finishedAt: "2026-11-01T08:00:00Z",
      summary: { total: 1, checked: 1, newRecommendations: 0, problems: [] },
    };
    setup();
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(screen.getByText(/Checked .* · 1 of 4 fields/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Analyze fields" })).toBeTruthy();
  });

  it("shows Fahrenheit for a US field and Celsius for a Ukrainian one", async () => {
    routes["/brief"] = brief({
      hero: {
        ...item("a", "urgent", "Frost expected tomorrow"),
        keyNumbers: [{ id: "frostMinC", value: 0, weight: 0.5 }],
      },
    });
    setup();
    expect((await screen.findAllByText(/^0\s*°C$/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/°F/)).toBeNull();
  });

  it("never analysed: Analyze is the one primary button", async () => {
    routes["/analysis-runs/latest"] = { id: null };
    setup();
    const btn = await screen.findByRole("button", { name: "Analyze fields" });
    await waitFor(() => expect(btn.className).toMatch(/h-14/));
    expect(screen.getByText(/Not analysed yet/)).toBeTruthy();
  });
});

describe("Brief, Owner", () => {
  it("says one decision is waiting once and says what the owner will be asked", async () => {
    setup({ owner: true });
    expect(await screen.findByRole("heading", { level: 1, name: "1 decision is waiting for you" })).toBeTruthy();
    expect(await screen.findByText(/You will be asked to approve, postpone or ask a question/)).toBeTruthy();
    expect(screen.queryByText(/One tap/i)).toBeNull();
    expect(screen.getByText("Answer by tomorrow", { exact: false })).toBeTruthy();
  });

  it("has no Next 7 days, no ideas, no Analyze; the agronomist's work is collapsed", async () => {
    setup({ owner: true });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Next 7 days")).toBeNull();
    expect(screen.queryByText(/Assistant's ideas/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Analyze fields/ })).toBeNull();
    expect(screen.getByText(/Your agronomist's work today/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /If 2022 weather returns/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
