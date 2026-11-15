import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../../messages/app.en.json";
import messages from "../../../../messages/en.json";
import { FieldTabs, RisksCard, StatusChips, type Risk } from "./Overview";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const risk = (id: string, title: string, level: Risk["level"]): Risk => ({
  id,
  level,
  status: "open",
  deadline: null,
  planning: false,
  keyNumbers: [],
  text: { title: { en: title, uk: title }, action: { en: "Act", uk: "Act" } },
});

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ App: app.App, Field: messages.Field }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("field Overview blocks", () => {
  it("lists the top 3 risks by level as links and expands with Show all", () => {
    wrap(
      <RisksCard
        risks={[
          risk("a", "Low thing", "low"),
          risk("b", "Corn rootworm", "high"),
          risk("c", "Moderate thing", "moderate"),
          risk("d", "Another low", "low"),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /rootworm/i }).getAttribute("href")).toBe("/recommendations/b");
    expect(screen.queryByText("Another low")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 4" }));
    expect(screen.getByText("Another low")).toBeTruthy();
  });

  it("status chips say it in words", () => {
    wrap(
      <StatusChips
        crop="Corn"
        plan={{ season: 2027, crop: "Soybean", agreed: false }}
        irrigation="irrigated"
        land={{ status: "limited", overridden: false }}
        attention={2}
        units="metric"
      />,
    );
    expect(screen.getByText("Crop: Corn")).toBeTruthy();
    expect(screen.getByText("Limited")).toBeTruthy();
    expect(screen.getByText("2 items need attention")).toBeTruthy();
  });

  it("FieldTabs keeps the sub-pages linked to the four v5 sections", () => {
    wrap(<FieldTabs fieldId="f1" active={2} />);
    expect(screen.getByRole("link", { name: "Plan" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Data & history" }).getAttribute("href")).toBe("/fields/f1?tab=data");
  });
});
