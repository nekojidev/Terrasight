import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import design from "../../messages/en.json";
import app from "../messages/app.en.json";
import { ModelVsActualChart } from "./ModelVsActualChart";

afterEach(cleanup);

const years = [2018, 2019, 2020, 2021, 2022];
const props = {
  years,
  series: [
    { id: "model", label: "Model", values: [0, 0, 0, 0, -2.9] },
    { id: "county", label: "Official yield", values: [3, null, 5, 2, -2.9] },
    { id: "ndvi", label: "Field NDVI", values: [1, 2, 3, 4, 4.8] },
  ],
  unitLabel: "% against a normal year",
  missYears: [2019],
  ariaLabel: "chart",
  tableCaption: "caption",
};

const wrap = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ ...design, ...app }}>
      <ModelVsActualChart {...props} />
    </NextIntlClientProvider>,
  );

describe("ModelVsActualChart", () => {
  it("puts no series labels on the plot (so none can overlap); the legend row names the series", () => {
    wrap();
    const svgText = Array.from(document.querySelectorAll('svg[role="img"] text')).map((n) => n.textContent ?? "");
    expect(svgText.some((s) => /Model|Official yield|Field NDVI/.test(s))).toBe(false);
    const legend = screen.getByRole("list", { name: "Series" });
    expect(legend.textContent).toContain("Model");
    expect(legend.textContent).toContain("Official yield");
    expect(legend.textContent).toContain("Field NDVI");
  });

  it("tells the series apart without colour: three marker shapes and three dash patterns", () => {
    wrap();
    const plot = document.querySelector('svg[role="img"]')!;
    expect(plot.querySelectorAll("circle:not([data-testid])").length).toBeGreaterThan(0);
    expect(plot.querySelectorAll("rect.fill-ink-2").length).toBeGreaterThan(0);
    expect(plot.querySelectorAll("polygon").length).toBeGreaterThan(0);
    const dashes = new Set(Array.from(plot.querySelectorAll("polyline")).map((p) => p.getAttribute("stroke-dasharray")));
    expect(dashes.size).toBeGreaterThan(1);
    expect(screen.getAllByTestId("miss-ring")).toHaveLength(1);
  });

  it("keeps a table view with every number", () => {
    wrap();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("4.8")).toBeTruthy();
    expect(screen.getByText("missed")).toBeTruthy();
  });
});
