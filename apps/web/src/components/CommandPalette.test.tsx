import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../messages/app.en.json";
import { AssistantBusProvider } from "./AssistantBus";
import { CommandPalette } from "./CommandPalette";

const push = vi.fn();
let pathname = "/";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));
vi.mock("@/lib/api", () => ({
  api: vi.fn(async (path: string) => {
    if (path.endsWith("/fields"))
      return [
        { id: "11111111-1111-4111-8111-111111111111", name: "Pivot 12", countyName: "Finney County", adminCode: "KS" },
        { id: "22222222-2222-4222-8222-222222222222", name: "North strip", countyName: "Lviv oblast", adminCode: null },
      ];
    throw new Error("no overview");
  }),
}));

const messages = { App: app.App, EmptyHome: { n_rot: "Rotations", n_today: "Today", n_fields: "Fields", n_ai: "Assistant" }, Assistant: { k1: "Analyze fields" } };

function setup(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        <AssistantBusProvider>
          <CommandPalette workspaceId="w" role="owner" open onClose={onClose} />
        </AssistantBusProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { onClose, box: screen.getByRole("combobox") };
}

beforeEach(() => {
  push.mockClear();
  pathname = "/";
  localStorage.clear();
});
afterEach(cleanup);

describe("CommandPalette", () => {
  it("is a labelled dialog with a combobox that owns a listbox, focused on open", () => {
    const { box } = setup();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    // Empty state: suggested questions
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("typing shows the ask row first, then matching fields; Enter on a field opens it", async () => {
    const { box, onClose } = setup();
    fireEvent.change(box, { target: { value: "pivot" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    const opts = screen.getAllByRole("option");
    expect(opts[0]!.textContent).toContain("Ask the assistant: “pivot”");
    expect(opts[1]!.textContent).toContain("Pivot 12");
    expect(box.getAttribute("aria-activedescendant")).toBe(opts[0]!.id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(opts[1]!.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/fields/11111111-1111-4111-8111-111111111111");
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter on the ask row opens the assistant with the question; on a field page it adds the field", async () => {
    pathname = "/fields/33333333-3333-4333-8333-333333333333";
    const { box } = setup();
    fireEvent.change(box, { target: { value: "why risk?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(
      "/assistant?q=why+risk%3F&field=33333333-3333-4333-8333-333333333333",
    );
  });

  it("finds pages, wraps with ArrowUp, and Escape closes", () => {
    const { box, onClose } = setup();
    fireEvent.change(box, { target: { value: "rotations" } });
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.textContent).join("|")).toContain("Rotations");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.getAttribute("aria-activedescendant")).toBe(opts.at(-1)!.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/rotation");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the dialog", () => {
    const { box } = setup();
    const close = screen.getByRole("button", { name: "Close search" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
  });
});
