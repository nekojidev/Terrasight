import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../../messages/app.en.json";
import messages from "../../../../messages/en.json";
import type { History } from "./fieldTypes";
import { SeasonHistory } from "./SeasonHistory";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
afterEach(cleanup);

const history: History = {
  built: { at: "2026-11-15", provisional: false },
  seasons: [
    { season: 2024, mainCrop: "corn", secondCrop: null, confidence: 0.9, source: "cdl", isOverride: false },
    { season: 2025, mainCrop: "soybean", secondCrop: null, confidence: 0.6, source: "ndvi", isOverride: false },
  ],
  stressYears: [{ season: 2024, reasons: ["dry"] }],
  seasonStats: [{ season: 2024, precipMm: 310, heatDays: 12, peak: 0.71 }],
  irrigation: { value: "dryland", source: "estimate", detection: null },
  currentRotation: null,
  cropNames: { corn: { en: "Corn", uk: "Кукурудза" }, soybean: { en: "Soybean", uk: "Соя" } },
};

function setup(country = "US") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ App: app.App, Field: messages.Field }}>
      <div>
        <SeasonHistory history={history} fieldId="f1" units="metric" country={country} compact />
        <button type="button">outside</button>
      </div>
    </NextIntlClientProvider>,
  );
}

describe("SeasonHistory", () => {
  it("names the latest season in the strip label and keeps 18 tiles of at least 44 px", () => {
    setup();
    const list = document.querySelector('ol[aria-label*="2025"]');
    expect(list).toBeTruthy();
    expect(list!.querySelectorAll("li")).toHaveLength(18);
    expect(list!.className).toContain("overflow-x-auto");
    expect(list!.className).toContain("snap-x");
    expect(list!.querySelector("li")!.className).toContain("min-w-11");
  });

  it("marks estimates with ≈ and a legend entry, and names the crop in words", () => {
    setup();
    expect(screen.getByText(/an estimate from satellite images/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Season 2025: Soybean \(estimate\)/ })).toBeTruthy();
    expect(screen.getAllByText("Corn").length).toBeGreaterThan(0);
  });

  it("opens on tap with stats in the user's units, closes on Esc and on outside tap", () => {
    setup("US");
    const tile = screen.getByRole("button", { name: /Season 2024: Corn/ });
    fireEvent.click(tile);
    const panel = screen.getByRole("region", { name: "Season 2024" });
    expect(panel.textContent).toContain("Corn");
    fireEvent.keyDown(tile, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Season 2024" })).toBeNull();
    fireEvent.focus(tile);
    expect(screen.getByRole("region", { name: "Season 2024" })).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("region", { name: "Season 2024" })).toBeNull();
  });
});
