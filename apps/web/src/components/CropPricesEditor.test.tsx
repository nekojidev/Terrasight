import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import built from "../../messages/en.json";
import app from "../messages/app.en.json";
import { CropPricesEditor } from "./CropPricesEditor";

const view = {
  currency: "USD",
  canChangeCurrency: true,
  crops: [
    { id: "corn", en: "Corn", uk: "Кукурудза" },
    { id: "winter_wheat", en: "Winter wheat", uk: "Пшениця озима" },
  ],
  rows: [
    {
      crop: "corn",
      pricePerT: 200,
      variableCostPerHa: 600,
      yieldRefTHa: null,
      irrigated: null,
      usable: true,
    },
  ],
};
const get = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => get(...a) }));

afterEach(() => {
  cleanup();
  get.mockReset();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ ...built, App: app.App }}>
      <QueryClientProvider client={client}>
        <CropPricesEditor workspaceId="w1" allowAdd />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("CropPricesEditor", () => {
  it("shows an error with Retry when loading fails, then the editor after Retry", async () => {
    get.mockRejectedValueOnce(new Error("down")).mockResolvedValue(view);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Corn")).toBeTruthy();
  });

  it("uses decimal inputs with the currency shown, translated names and the agronomy-only line", async () => {
    get.mockResolvedValue(view);
    const { container } = mount();
    await screen.findByText("Corn");
    expect(container.querySelectorAll("input[inputmode='decimal']").length).toBe(3);
    expect(container.textContent).toContain("USD per t");
    expect(container.textContent).toContain("USD per ha");
    expect(container.textContent).toContain("agronomy-only mode");
    expect(container.textContent).not.toContain("winter_wheat");
  });
});
