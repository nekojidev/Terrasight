import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FarmStress } from "@terrasight/shared";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import appEn from "../messages/app.en.json";
import appUk from "../messages/app.uk.json";
import { FarmStressCard } from "./FarmStressCard";

afterEach(cleanup);

const base: FarmStress = {
  status: "ready",
  stressYear: 2022,
  season: 2026,
  currency: "USD",
  current: { atRisk: 80000, typical: 400000 },
  recommended: { atRisk: 50000, typical: 400000 },
  difference: 30000,
  counted: [
    {
      fieldId: "f1",
      name: "Pivot 12",
      areaHa: 50,
      currentLoss: 80000,
      recommendedLoss: 50000,
      recommendedId: "s2",
    },
  ],
  notCounted: [],
};

function show(
  data: FarmStress | undefined,
  opts: { isLoading?: boolean; isError?: boolean; isOwner?: boolean; lang?: "en" | "uk" } = {},
) {
  const onRetry = vi.fn();
  const lang = opts.lang ?? "en";
  const r = render(
    <NextIntlClientProvider
      locale={lang}
      messages={{ ...(lang === "en" ? en : uk), ...(lang === "en" ? appEn : appUk) }}
    >
      <FarmStressCard
        data={data}
        isLoading={opts.isLoading ?? false}
        isError={opts.isError ?? false}
        onRetry={onRetry}
        isOwner={opts.isOwner ?? true}
      />
    </NextIntlClientProvider>,
  );
  return { ...r, onRetry };
}

describe("FarmStressCard", () => {
  it("positive difference: says the recommended plan puts less at risk, shows both numbers and the method", () => {
    show(base);
    expect(screen.getByText(/Stress test · if the weather of 2022 repeats in one of the seasons from 2026/)).toBeTruthy();
    expect(screen.getByText(/puts \$30,000 less at risk than the current plan/)).toBeTruthy();
    expect(screen.getByText("$80,000")).toBeTruthy();
    expect(screen.getByText("$50,000")).toBeTruthy();
    expect(screen.getAllByText("at risk").length).toBe(2);
    expect(screen.getAllByText(/of \$400,000 typical margin for a season/).length).toBe(2);
    expect(screen.getByText(/20%/)).toBeTruthy();
    expect(screen.getByText("1 of 1 fields counted")).toBeTruthy();
    expect(screen.getByTestId("farm-stress-method").textContent).toMatch(/no new model/);
    const link = screen.getByRole("link", { name: /Pivot 12/, hidden: true });
    expect(link.getAttribute("href")).toBe("/fields/f1/rotation");
  });

  it("zero difference: the current plan is already the recommended one", () => {
    show({
      ...base,
      recommended: { atRisk: 80000, typical: 400000 },
      difference: 0,
      counted: [{ ...base.counted[0]!, recommendedLoss: 80000 }],
    });
    expect(screen.getByText(/already the recommended one: \$80,000 at risk/)).toBeTruthy();
  });

  it("negative difference: says plainly that the recommended plan loses more", () => {
    show({ ...base, recommended: { atRisk: 100000, typical: 400000 }, difference: -20000 });
    expect(screen.getByText(/loses \$20,000 more than the current plan/)).toBeTruthy();
    expect(screen.getByText(/recommended for other reasons/)).toBeTruthy();
  });

  it("lists fields not counted with a reason in words; Prices link only for the Owner", () => {
    const data: FarmStress = {
      ...base,
      notCounted: [
        { fieldId: "f2", name: "North", reason: "no-run" },
        { fieldId: "f3", name: "East", reason: "no-prices" },
        { fieldId: "f4", name: "Marsh", reason: "land-unsuitable" },
        { fieldId: "f5", name: "West", reason: "no-2022-weather" },
      ],
    };
    show(data);
    expect(screen.getByText("1 of 5 fields counted")).toBeTruthy();
    expect(screen.getByText(/open the Plan tab once/)).toBeTruthy();
    expect(screen.getByText(/no weather for 2022/)).toBeTruthy();
    expect(screen.getByText(/land unsuitable for crops/)).toBeTruthy();
    expect(screen.getByText("Settings › Prices").getAttribute("href")).toBe("/settings/prices");
    cleanup();
    show(data, { isOwner: false });
    expect(screen.queryByText("Settings › Prices")).toBeNull();
    expect(screen.getByText(/no crop prices/)).toBeTruthy();
  });

  it("nothing counted: a short honest line with what is needed", () => {
    show({
      ...base,
      status: "unavailable",
      current: null,
      recommended: null,
      difference: null,
      counted: [],
      notCounted: [{ fieldId: "f2", name: "North", reason: "no-run" }],
    });
    expect(screen.getByText(/Nothing to compute yet/)).toBeTruthy();
    expect(screen.getByText(/open the Plan tab once/)).toBeTruthy();
  });

  it("loading shows a skeleton and no numbers", () => {
    show(undefined, { isLoading: true });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(/at risk/)).toBeNull();
  });

  it("error shows a card with Retry", () => {
    const { onRetry } = show(undefined, { isError: true });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders in Ukrainian", () => {
    show(base, { lang: "uk" });
    expect(screen.getByText(/Рекомендований план ризикує на/)).toBeTruthy();
  });
});
