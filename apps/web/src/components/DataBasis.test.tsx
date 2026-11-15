import type { DataBasisItem } from "@terrasight/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { DataBasis } from "./DataBasis";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const power: DataBasisItem = {
  dataset: "NASA POWER",
  agency: "NASA",
  from: "2026-09-20",
  to: "2026-11-12",
  lastDate: "2026-11-12",
  supports: ["degree-days"],
};
const meteo: DataBasisItem = {
  dataset: "Open-Meteo",
  agency: "other",
  from: "2026-11-13",
  to: "2026-11-19",
  lastDate: "2026-11-15",
  supports: ["forecast"],
};

function wrap(ui: ReactNode, locale: "en" | "uk" = "en") {
  const messages = locale === "en" ? en : uk;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ Rec: messages.Rec }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DataBasis", () => {
  it("lists NASA datasets first with period, last date and the conclusion; other sources follow", () => {
    wrap(<DataBasis items={[meteo, power]} trustHref="/fields/f1/trust" />);
    expect(screen.getByRole("heading", { name: "What NASA data contributed here" })).toBeTruthy();
    expect(screen.getByText("NASA POWER")).toBeTruthy();
    expect(screen.getByText(/Period used: September 20, 2026 to November 12, 2026/)).toBeTruthy();
    expect(screen.getByText(/last data: November 12, 2026/)).toBeTruthy();
    expect(screen.getByText(/heat accumulated since sowing/)).toBeTruthy();
    expect(screen.getByText("Other sources")).toBeTruthy();
    expect(screen.getByText("Open-Meteo")).toBeTruthy();
    expect(screen.getByRole("link", { name: "How far can you trust this" }).getAttribute("href")).toBe(
      "/fields/f1/trust",
    );
  });

  it("says so when no NASA dataset fed the item", () => {
    wrap(<DataBasis items={[{ ...meteo }]} />);
    expect(screen.getByText("No NASA dataset fed this item. It rests on the sources below.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says so when nothing is recorded", () => {
    wrap(<DataBasis items={[]} />);
    expect(screen.getByText("No dataset is recorded for this item.")).toBeTruthy();
  });

  it("shows whole-season periods as years and has copy for every supports id in Ukrainian", () => {
    const ids = [
      "weather-years", "stress-2022", "climate-shift", "degree-days", "crop-history", "stress-years",
      "soil-water", "forecast", "green-bridge", "rain-check", "crop-estimate",
    ];
    for (const id of ids) {
      expect((en.Rec as Record<string, string>)[`basis_supports_${id}`]).toBeTruthy();
      expect((uk.Rec as Record<string, string>)[`basis_supports_${id}`]).toBeTruthy();
    }
    wrap(
      <DataBasis
        items={[
          { dataset: "MODIS NDVI (MOD13Q1)", agency: "NASA", from: "2023-01-01", to: "2024-12-31", lastDate: null, supports: ["crop-estimate"] },
        ]}
      />,
      "uk",
    );
    expect(screen.getByText("Що сюди дали дані NASA")).toBeTruthy();
    expect(screen.getByText("Сезони 2023–2024")).toBeTruthy();
  });

  it("compact hides the sentences", () => {
    wrap(<DataBasis items={[power]} compact />);
    expect(screen.queryByText(/heat accumulated/)).toBeNull();
    expect(screen.getByText("NASA POWER")).toBeTruthy();
  });
});
