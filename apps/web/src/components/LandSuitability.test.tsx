import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../messages/app.en.json";
import uk from "../messages/app.uk.json";
import {
  LandBanner,
  LandBlocked,
  LandChip,
  LandPreviewWarning,
  LandSuitabilityCard,
  type LandView,
} from "./LandSuitability";

const calls: Array<{ path: string; method?: string }> = [];
vi.mock("@/lib/api", () => ({
  api: vi.fn(async (path: string, opts?: { method?: string }) => {
    calls.push({ path, method: opts?.method });
    return {};
  }),
}));
vi.mock("@/lib/useActionToast", () => ({ useActionToast: () => ({ fail: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  calls.length = 0;
});

const reason = (over: Partial<LandView["reasons"][number]> = {}): LandView["reasons"][number] => ({
  code: "land_cover_not_farmland",
  level: "unsuitable",
  value: 72,
  threshold: 60,
  unit: "%",
  source: "Esri: Land cover",
  sourceUrl: "https://example.org/lc",
  verified: true,
  mvpDefault: true,
  detail: "built",
  ...over,
});
const unsuitable: LandView = { status: "unsuitable", reasons: [reason()], override: null, blocked: true };

function wrap(ui: ReactNode, messages: typeof app | typeof uk = app, locale = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale={locale} messages={{ App: messages.App }}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("Land suitability card", () => {
  it("shows the status, the reasons with values and the source", () => {
    wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={unsuitable} canEdit />);
    expect(screen.getByText("Not suitable for crops")).toBeTruthy();
    expect(screen.getByText(/72% of this outline as not farmland, mostly built-up land/)).toBeTruthy();
    expect(screen.getByText(/Threshold: Esri: Land cover/)).toBeTruthy();
    expect(screen.getByText(/working value, no source yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe("https://example.org/lc");
  });

  it("the override stores nothing in the browser: it calls the API and refreshes", async () => {
    wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={unsuitable} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /still cropland/ }));
    await waitFor(() =>
      expect(calls).toContainEqual({ path: "/api/w/w/fields/f/suitability-override", method: "PUT" }),
    );
  });

  it("an overridden field shows who and when, and can be reverted", async () => {
    const view: LandView = {
      ...unsuitable,
      blocked: false,
      override: { userId: "u", userName: "Olena", at: "2026-11-15T10:00:00Z" },
    };
    wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={view} canEdit />);
    expect(screen.getByText(/Marked as cropland by Olena on/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /still cropland/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove the override" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ path: "/api/w/w/fields/f/suitability-override", method: "DELETE" }),
    );
  });

  it("a viewer cannot override", () => {
    wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={unsuitable} canEdit={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing before the check has run, and 'not checked' for unknown", () => {
    const { container } = wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={null} canEdit />);
    expect(container.textContent).toBe("");
    cleanup();
    wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={{ status: "unknown", reasons: [] }} canEdit />);
    expect(screen.getByText("Not checked yet")).toBeTruthy();
    expect(screen.getByText(/Nothing is blocked/)).toBeTruthy();
  });

  it("speaks Ukrainian", () => {
    wrap(<LandSuitabilityCard workspaceId="w" fieldId="f" suitability={unsuitable} canEdit />, uk, "uk");
    expect(screen.getByText("Непридатна для культур")).toBeTruthy();
    expect(screen.getByText(/72% контуру не є сільгоспземлею, переважно це забудовані території/)).toBeTruthy();
  });
});

describe("banner, blocked explanation, chip and preview warning", () => {
  it("the banner is only for limited land", () => {
    const limited: LandView = { status: "limited", reasons: [reason({ level: "limited", code: "slope_steep", value: 18, threshold: 15, detail: undefined })] };
    wrap(<LandBanner suitability={limited} fieldId="f" />);
    expect(screen.getByText(/This land has limits for crops/)).toBeTruthy();
    expect(screen.getByText(/average slope is 18%, steeper than 15%/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the land check" }).getAttribute("href")).toBe("/fields/f");
    cleanup();
    const { container } = wrap(<LandBanner suitability={unsuitable} />);
    expect(container.textContent).toBe("");
  });

  it("the blocked explanation replaces the options and offers the override to agronomists", async () => {
    wrap(<LandBlocked workspaceId="w" fieldId="f" suitability={unsuitable} canEdit />);
    expect(screen.getByText("No crop options for this field")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /still cropland/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    cleanup();
    wrap(<LandBlocked workspaceId="w" fieldId="f" suitability={unsuitable} canEdit={false} />);
    expect(screen.getByText("Ask an agronomist to review the land.")).toBeTruthy();
  });

  it("the chip marks unsuitable, limited and overridden land only", () => {
    const { container, rerender } = wrap(<LandChip status="unsuitable" />);
    expect(container.textContent).toBe("Not farmland");
    const again = (ui: ReactNode) =>
      rerender(
        <NextIntlClientProvider locale="en" messages={{ App: app.App }}>
          <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
        </NextIntlClientProvider>,
      );
    again(<LandChip status="unsuitable" overridden />);
    expect(container.textContent).toBe("Marked cropland");
    again(<LandChip status="limited" />);
    expect(container.textContent).toBe("Limited land");
    again(<LandChip status="suitable" />);
    expect(container.textContent).toBe("");
    again(<LandChip status={null} />);
    expect(container.textContent).toBe("");
  });

  it("the add-field preview warns before saving, and says the field can still be saved", () => {
    wrap(<LandPreviewWarning suitability={unsuitable} />);
    expect(screen.getByText("Check the boundary before saving")).toBeTruthy();
    expect(screen.getByText(/mostly built-up land/)).toBeTruthy();
    expect(screen.getByText("You can still save the field.")).toBeTruthy();
    cleanup();
    const { container } = wrap(<LandPreviewWarning suitability={{ status: "suitable", reasons: [] }} />);
    expect(container.textContent).toBe("");
    cleanup();
    const unknown = wrap(<LandPreviewWarning suitability={null} />);
    expect(unknown.container.textContent).toBe("");
  });
});
