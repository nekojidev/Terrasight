import type { Decision } from "@terrasight/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import appEn from "../messages/app.en.json";
import appUk from "../messages/app.uk.json";
import { OwnerDecisions } from "./OwnerDecisions";

afterEach(cleanup);

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  recommendationId: "r1",
  fieldId: "f1",
  fieldName: "North quarter",
  title: { en: "Rotation for 2026: wheat first", uk: "Сівозміна на 2026: першою пшениця" },
  question: {
    en: "Marko asks: may we change the rotation on North quarter to “Wheat” for 2026–2030?",
    uk: "Marko питає: чи змінюємо сівозміну на полі North quarter на «Пшениця» на 2026–2030?",
  },
  action: { en: "Consider it.", uk: "Розгляньте." },
  why: { en: "Tested on weather paths.", uk: "Перевірено." },
  deadline: "2099-04-25",
  keyNumbers: [
    { id: "hostSeasonsInPlan", value: "0/5" },
    { id: "lastCropInRow", value: 1, unit: "seasons" },
    { id: "marginVsCurrent", value: 40, unit: "$/ha" },
  ],
  askedAt: "2026-11-15T10:00:00Z",
  askedBy: { name: "Marko" },
  state: "waiting",
  changedSinceAsked: false,
  thread: [
    { id: "n", kind: "note", author: { name: "Marko", role: "agronomist" }, text: "Please confirm.", at: "2026-11-15T10:00:00Z" },
  ],
  ...over,
});

function view(items: Decision[], language: "en" | "uk" = "en", onAnswer: Parameters<typeof OwnerDecisions>[0]["onAnswer"] = vi.fn()) {
  return render(
    <NextIntlClientProvider locale={language} messages={(language === "en" ? { ...en, ...appEn } : { ...uk, ...appUk }) as never}>
      <OwnerDecisions items={items} language={language} workspaceName="Prairie" onAnswer={onAnswer} />
    </NextIntlClientProvider>,
  );
}

describe("OwnerDecisions card", () => {
  it("asks the plain question first and shows only an owner-readable number of this item", () => {
    view([decision()]);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toContain("Marko asks: may we change the rotation");
    expect(screen.getByText("+40 $/ha")).toBeTruthy();
    expect(screen.queryByText(/0\/5/)).toBeNull();
    expect(screen.queryByText(/USDA/)).toBeNull();
  });

  it("falls back to the title without a question and shows the interface language", () => {
    view([decision({ question: undefined })], "uk");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Сівозміна на 2026: першою пшениця");
  });

  it("says what each button does and keeps the Approve button", () => {
    view([decision()]);
    expect(screen.getByRole("button", { name: /Approve/ })).toBeTruthy();
    expect(screen.getByText("Marko adds this to the plan.")).toBeTruthy();
    expect(screen.getByText("Marko answers here.")).toBeTruthy();
  });

  it("confirms the answer on the card", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    view([decision()], "en", onAnswer);
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(screen.getByText(/You approved on/)).toBeTruthy());
    expect(onAnswer).toHaveBeenCalledWith("d1", "approve", undefined);
  });

  it("does not double the wording of a decided answer", () => {
    view([
      decision({
        state: "approved",
        thread: [
          { id: "a", kind: "answer", author: { name: "You", role: "owner" }, answer: "approve", text: "Approved. Go ahead.", at: "2026-11-16T10:00:00Z" },
        ],
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Answered \(1\)/ }));
    expect(screen.queryByText(/Approved: Approved/)).toBeNull();
    expect(screen.getAllByText(/Approved\. Go ahead\./).length).toBeGreaterThan(0);
  });

  it("explains what will appear when there are no decisions", () => {
    view([]);
    expect(screen.getByText(en.Report.emptyTitle)).toBeTruthy();
  });
});
