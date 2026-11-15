import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { ToolCard, TOOL_NAMES, humanize } from "./ToolCard";

afterEach(cleanup);

function show(tool: string, result: unknown, locale: "en" | "uk" = "en") {
  const messages = locale === "en" ? en : uk;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ToolCard tool={tool} result={result} aliases={{ F1: { name: "Pivot 12" } }} lang={locale} />
    </NextIntlClientProvider>,
  );
}

describe("ToolCard", () => {
  it("has a plain title for every tool in both languages and never shows the tool name", () => {
    for (const tool of TOOL_NAMES) {
      expect((en.Assistant.toolName as Record<string, string>)[tool]).toBeTruthy();
      expect((uk.Assistant.toolName as Record<string, string>)[tool]).toBeTruthy();
    }
    const { container } = show("get_weather", { field: "F1", precipitation: { value: 12, unit: "mm" } });
    expect(screen.getByText("Weather so far")).toBeTruthy();
    expect(container.textContent).not.toContain("get_weather");
  });

  it("falls back to a generic title for an unknown tool", () => {
    show("future_tool", { field: "F1" });
    expect(screen.getByText("Data from the models")).toBeTruthy();
  });

  it("renders labelled rows with units and restores field names", () => {
    show("get_weather", {
      field: "F1",
      precipitation: { value: 12, unit: "mm" },
      maxTemperature: { value: 30, unit: "°C" },
      from: "2026-07-01",
    });
    expect(screen.getByText("Pivot 12")).toBeTruthy();
    expect(screen.getByText("Rain").nextSibling?.textContent).toMatch(/12/);
    expect(screen.getByText("Highest temperature").nextSibling?.textContent).toMatch(/30/);
    expect(screen.getByText("July 1, 2026")).toBeTruthy();
  });

  it("hides unknown fields behind Details as plain text, not JSON paths", () => {
    const { container } = show("get_field_summary", { field: "F1", mysteryScore: 7, nested: { oddThing: "x y" } });
    expect(screen.getByText("Details")).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    expect(container.textContent).toContain("Mystery score → 7");
    expect(container.textContent).toContain("Odd thing → x y");
    expect(container.textContent).not.toContain("nested.oddThing");
  });

  it("groups list items under their own heading and keeps raw codes out of the rows", () => {
    show("get_forecast", { provider: "open-meteo", days: [{ date: "2026-07-02", precipitation: { value: 3, unit: "mm" } }] });
    expect(screen.getByText("July 2, 2026")).toBeTruthy();
    expect(screen.queryByText("Rain")).toBeTruthy();
  });

  it("works in Ukrainian", () => {
    show("get_weather", { field: "F1", frostDays: { value: 2, unit: "days" } }, "uk");
    expect(screen.getByText("Погода за період")).toBeTruthy();
    expect(screen.getByText("Дні з морозом").nextSibling?.textContent).toContain("дн.");
  });
});

describe("humanize", () => {
  it("turns keys into words", () => {
    expect(humanize("meanTemperature")).toBe("Mean temperature");
    expect(humanize("some_key")).toBe("Some key");
  });
});
