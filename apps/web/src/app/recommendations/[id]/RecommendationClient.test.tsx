import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@terrasight/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../../messages/app.en.json";
import en from "../../../../messages/en.json";
import { RecommendationClient, type RecView } from "./RecommendationClient";

vi.mock("@/lib/api", () => ({ api: vi.fn(() => new Promise(() => undefined)), ApiError: class extends Error {} }));
vi.mock("@/lib/events", () => ({ useWorkspaceEvents: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const base: RecView = {
  id: "r1",
  fieldId: "f1",
  fieldName: "Pivot 12",
  type: "pest",
  subject: "rootworm",
  season: 2027,
  status: "open",
  level: "high",
  confidence: "high",
  tier: "A",
  deadline: "2027-04-25",
  planning: true,
  irreversible: false,
  keyNumbers: [{ id: "hostSeasonsInRow", value: 1, weight: 0.8 }],
  drivers: [],
  evidence: [],
  unknowns: [],
  text: {
    title: { en: "Western corn rootworm: high risk on corn", uk: "x" },
    action: { en: "Plan for 2027: rotate away from corn.", uk: "x" },
    why: { en: "Corn after corn.", uk: "x" },
    scout: { en: "Dig and wash roots.", uk: "x" },
  },
  edited: false,
  textSource: "ai",
  snoozedUntil: null,
  undoUntil: null,
};

function show(rec: RecView, canAct: boolean) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ App: app.App, Rec: en.Rec, Main: en.Main, Field: en.Field, System: en.System }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">
          <RecommendationClient
            workspaceId="w"
            timeZone="UTC"
            canAct={canAct}
            canAsk={canAct}
            initial={rec}
          />
        </ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("Recommendation page", () => {
  it("shows risk as the one big item, one trust line, a visible AI mark and the P0 controls", () => {
    show(base, true);
    expect(screen.getByTestId("risk").textContent).toContain("High");
    expect(screen.getAllByTestId("trust-line")).toHaveLength(1);
    expect(screen.getAllByTestId("ai-mark").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Accept$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask the owner" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a check" })).toBeTruthy();
    expect(screen.getByText(/Why\?/).closest("a")).toBeTruthy();
    expect(screen.queryByText("Message to the owner")).toBeNull();
    expect(screen.queryByText("Options for action")).toBeNull();
    expect(document.getElementById("evidence")).toBeTruthy();
  });

  it("owner view has no field tools and no message to himself", () => {
    show(base, false);
    expect(screen.queryByRole("button", { name: "Start a check" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask the owner" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Accept$/ })).toBeNull();
  });

  it("an AI-suggested item gets one honest line and no risk, reliability or data level", () => {
    show({ ...base, aiSuggested: true, level: "unknown", confidence: "low" }, true);
    expect(screen.getByText(/not yet checked by the models/)).toBeTruthy();
    expect(screen.queryByTestId("risk")).toBeNull();
    expect(screen.queryByTestId("trust-line")).toBeNull();
  });

  it("a rotation item shows no risk gauge", () => {
    show({ ...base, type: "rotation", level: "low" }, true);
    expect(screen.queryByTestId("risk")).toBeNull();
  });
});
