import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@terrasight/ui";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../../messages/app.en.json";
import en from "../../../../messages/en.json";
import { ScoutClient, type ScoutTask } from "./ScoutClient";

vi.mock("@/lib/api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@/lib/offline", () => ({
  loadDraft: () => null,
  saveDraft: () => undefined,
  clearDraft: () => undefined,
  useOnline: () => true,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

const task: ScoutTask = {
  id: "t",
  status: "open",
  recommendationId: "r",
  fieldName: "Pivot",
  pest: { id: "p", name: { en: "Aphids", uk: "Попелиці" }, scout: null },
  outline: null,
  points: [1, 2, 3, 4, 5].map((idx) => ({ idx, lon: 0, lat: 0, affected: null })),
  resultPct: null,
  sentAt: null,
  photos: [],
};

function show() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ App: app.App, Scout: en.Scout }}>
      <ToastProvider dismissLabel="Dismiss">
        <ScoutClient workspaceId="w" initial={task} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("Field check", () => {
  it("never records 0 silently: asks first, Go back keeps the point empty", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next point" }));
    expect(screen.getByText("Nothing found at this point?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByText("Nothing found at this point?")).toBeNull();
    expect(screen.getByText("0 / 5")).toBeTruthy();
  });

  it("Record 0 counts the point and moves on", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next point" }));
    fireEvent.click(screen.getByRole("button", { name: "Record 0" }));
    expect(screen.getByText("1 / 5")).toBeTruthy();
    expect(screen.getByText("Point 2 of 5")).toBeTruthy();
  });

  it("keeps Send disabled with a reason until every point is counted", () => {
    show();
    const send = screen.getByRole("button", { name: "Send to the agronomist" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/still to count before you can send: 5/)).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      fireEvent.click(screen.getByRole("button", { name: i === 4 ? "Finish the check" : "Next point" }));
    }
    expect(send.disabled).toBe(false);
    expect(screen.getByText("5 / 5")).toBeTruthy();
    expect(screen.getByText("5%")).toBeTruthy();
  });
});
