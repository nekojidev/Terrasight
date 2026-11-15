import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import uk from "../../messages/uk.json";
import { formatDateRelative, moneyPerArea } from "../lib/format";
import { Evidence } from "./Evidence";
import { InsightRow } from "./InsightRow";
import { NoticeStack } from "./NoticeStack";
import { SuggestionChips } from "./SuggestionChips";
import { TrustLine } from "./TrustLine";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function wrap(ui: ReactNode, locale: "en" | "uk" = "en") {
  const messages = locale === "en" ? en : uk;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ System: messages.System }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("TrustLine", () => {
  it("renders reliability, data level, two sources then +N, and the date", () => {
    wrap(
      <TrustLine
        reliability="high"
        dataLevel="A"
        sources={["NASA POWER", "USDA CDL", "SSURGO"]}
        lastDate="2026-11-12"
        estimate
      />,
    );
    const text = screen.getByTestId("trust-line").textContent ?? "";
    expect(text).toContain("Reliability: High");
    expect(text).toContain("Full data");
    expect(text).toContain("≈ estimate");
    expect(text).toContain("NASA POWER, USDA CDL +1");
    expect(text).not.toContain("SSURGO");
    expect(text).toContain("data to 12 Nov");
  });

  it("uses the Ukrainian level names and is a link when href is given", () => {
    wrap(<TrustLine dataLevel="C" reliability="low" href="#evidence" />, "uk");
    const el = screen.getByTestId("trust-line");
    expect(el.tagName).toBe("A");
    expect(el.textContent).toContain("Оцінка");
    expect(el.textContent).toContain("Надійність: Низька");
  });

  it("compact drops sources and date; button when onClick; nothing when empty", () => {
    const onClick = vi.fn();
    wrap(<TrustLine dataLevel="B" sources={["A"]} lastDate="2026-11-12" compact onClick={onClick} />);
    const el = screen.getByTestId("trust-line");
    expect(el.tagName).toBe("BUTTON");
    expect(el.textContent).toBe("Basic data");
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalled();
    cleanup();
    const { container } = wrap(<TrustLine />);
    expect(container.textContent).toBe("");
  });
});

describe("Evidence", () => {
  it("shows the summary while closed and opens on click", () => {
    wrap(
      <Evidence summary="3 checks · 2 sources" count={3}>
        <p>proof</p>
      </Evidence>,
    );
    expect(screen.getByText("3 checks · 2 sources")).toBeTruthy();
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("3 checks · 2 sources")).toBeNull();
  });

  it("opens when the URL hash matches its id", () => {
    window.location.hash = "#evidence";
    wrap(
      <Evidence summary="s">
        <p>proof</p>
      </Evidence>,
    );
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("NoticeStack", () => {
  const notices = [
    { id: "a", tone: "urgent" as const, title: "Frost tonight", action: { label: "See plan", href: "/plan" } },
    { id: "b", tone: "info" as const, title: "Soil is an estimate" },
    { id: "c", tone: "week" as const, title: "Sow next week" },
  ];
  it("shows the first notice and folds the rest", () => {
    wrap(<NoticeStack notices={notices} />);
    expect(screen.getByText("Frost tonight")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See plan" }).getAttribute("href")).toBe("/plan");
    expect(screen.getByText("2 more notes")).toBeTruthy();
    const first = document.querySelector("[data-notice='a']");
    expect(first?.getAttribute("role")).toBe("alert");
    fireEvent.click(screen.getByRole("button", { name: /2 more notes/ }));
    expect(screen.getByRole("button", { name: /2 more notes/ }).getAttribute("aria-expanded")).toBe("true");
  });
  it("renders nothing without notices and no fold for one", () => {
    const { container } = wrap(<NoticeStack notices={[]} />);
    expect(container.textContent).toBe("");
    cleanup();
    wrap(<NoticeStack notices={notices.slice(0, 1)} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SuggestionChips and InsightRow", () => {
  it("calls onAsk with the question", () => {
    const onAsk = vi.fn();
    const q = { id: "q1", text: "When should I sow?" };
    wrap(<SuggestionChips questions={[q, { id: "q2", text: "Do I irrigate?" }]} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: /When should I sow/ }));
    expect(onAsk).toHaveBeenCalledWith(q);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
  it("InsightRow is one link with the value in mono", () => {
    wrap(<InsightRow icon={<span />} title="Soil carbon" value="+0.2 t/ha" note="vs last year" href="/x" linkLabel="Open" />);
    const a = screen.getByRole("link");
    expect(a.getAttribute("href")).toBe("/x");
    expect(screen.getByText("+0.2 t/ha").className).toContain("font-mono");
    expect(a.textContent).toContain("Open");
  });
});

describe("format additions", () => {
  it("moneyPerArea follows the unit system", () => {
    const flat = (x: string) => x.replace(/\u00A0/g, " ");
    expect(flat(moneyPerArea(100, "USD", "metric", "en"))).toBe("$100 per ha");
    expect(flat(moneyPerArea(100, "USD", "imperial", "en"))).toBe("$40 per ac");
    expect(flat(moneyPerArea(100, "UAH", "metric", "uk"))).toContain("за га");
  });
  it("date rule: words only for yesterday, today, tomorrow", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const z = { timeZone: "UTC" };
    expect(formatDateRelative("2026-11-15", now, "en", "short", z)).toBe("today");
    expect(formatDateRelative("2026-11-16", now, "en", "short", z)).toBe("tomorrow");
    expect(formatDateRelative("2026-11-14", now, "en", "short", z)).toBe("yesterday");
    expect(formatDateRelative("2026-11-12", now, "en", "short", z)).toBe("12 Nov");
    expect(formatDateRelative("2026-11-12", now, "en", "long", z)).toBe("12 November 2026");
  });
});
