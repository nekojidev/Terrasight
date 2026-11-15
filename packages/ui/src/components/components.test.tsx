import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BigNumber,
  BottomSheet,
  Button,
  Chip,
  ConfirmDialog,
  Disclosure,
  Kicker,
  Menu,
  PageContainer,
  ProgressBar,
  Skeleton,
  StatusDot,
  Surface,
  Tabs,
  ToastProvider,
  useToast,
  DoneRow,
  FieldThumb,
  InfoHint,
  QueueRow,
  Sidebar,
  SeasonLabel,
  SeasonStrip,
  seasonHintText,
} from "../index";

afterEach(cleanup);

describe("DoneRow (RFC §10.4)", () => {
  it("shows Undo while the server's window is open and hides it when it closes", () => {
    vi.useFakeTimers();
    let t = 0;
    const onUndo = vi.fn();
    render(
      <DoneRow
        label="Added to the owner report"
        undoLabel="Undo"
        undoUntil={8_000}
        onUndo={onUndo}
        now={() => t}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Added to the owner report");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    t = 8_100;
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    vi.useRealTimers();
  });

  it("never offers Undo once the window has passed", () => {
    render(
      <DoneRow
        label="Snoozed until tomorrow 06:00"
        undoLabel="Undo"
        undoUntil={1_000}
        onUndo={() => {}}
        now={() => 5_000}
      />,
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("Button", () => {
  it("gives icon buttons an accessible name", () => {
    render(<Button variant="icon" label="Accept" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

describe("BigNumber", () => {
  it("clamps the weight bar to 0–100", () => {
    render(<BigNumber value="124" label="days bare" weight={1.7} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
  });
});

describe("SeasonStrip", () => {
  it("describes the seasons for screen readers", () => {
    render(
      <SeasonStrip
        seasons={[
          { crop: "corn", name: "Corn", year: 2024 },
          { crop: "winter_wheat", name: "Winter wheat", year: 2025 },
        ]}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("2024: Corn, 2025: Winter wheat");
  });
});

describe("QueueRow", () => {
  it("expands Why on demand", () => {
    render(
      <QueueRow
        thumb={null}
        title="Count aphids on Pivot 14"
        meta="Pivot 14 · Finney County, KS"
        due="this week"
        factors={[{ label: "Warm autumn", weight: 0.8 }]}
        labels={{ why: "Why", accept: "Accept", snooze: "Snooze" }}
        onAccept={() => {}}
        onSnooze={() => {}}
      />,
    );
    const why = screen.getByRole("button", { name: "Why" });
    expect(why.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(why);
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Warm autumn")).toBeTruthy();
  });
});

describe("FieldThumb", () => {
  it("draws the real outline in the crop colour", () => {
    const { container } = render(<FieldThumb name="Pivot 14" outline="M0 0L100 0L100 60L0 60Z" crop="corn" />);
    const path = container.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M0 0L100 0L100 60L0 60Z");
    expect(path.getAttribute("fill")).toContain("var(--");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Pivot 14");
  });
  it("uses a neutral fill without a crop and no shape without an outline", () => {
    const { container } = render(<FieldThumb name="A" outline="M0 0L10 0L10 10Z" />);
    expect(container.querySelector("path")!.getAttribute("fill")).toBe("var(--ts-line-strong)");
    cleanup();
    const again = render(<FieldThumb name="B" />);
    expect(again.container.querySelector("path")).toBeNull();
  });
});

describe("InfoHint", () => {
  it("opens on click with a described tooltip and closes on Escape", () => {
    render(<InfoHint label="What does this mean?">Full data means US sources.</InfoHint>);
    const btn = screen.getByRole("button", { name: "What does this mean?" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(btn);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Full data");
    expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("toggles on a second tap and closes on a tap outside", () => {
    render(
      <div>
        <InfoHint label="Info">Hint</InfoHint>
        <p>elsewhere</p>
      </div>,
    );
    const btn = screen.getByRole("button", { name: "Info" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(btn);
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("opens on hover too", () => {
    render(<InfoHint label="Info">Hint</InfoHint>);
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});

describe("SeasonLabel", () => {
  it("fills the harvest year and the sowing year into the hint", () => {
    expect(seasonHintText("Season {year}: harvest {year}; sown autumn {prev}", 2027)).toBe(
      "Season 2027: harvest 2027; sown autumn 2026",
    );
    render(
      <SeasonLabel
        year={2027}
        label="Season 2027"
        hintLabel="What is a season?"
        hintTemplate="Harvest in {year}; winter crops sown in autumn {prev}."
      />,
    );
    expect(screen.getByText("Season 2027")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What is a season?" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Harvest in 2027; winter crops sown in autumn 2026.");
  });
});

describe("Sidebar", () => {
  const items = [
    { href: "/", label: "Today", icon: <i />, active: true, badge: 3 },
    { href: "/fields", label: "Fields", icon: <i /> },
  ];
  it("collapsed: labels stay for screen readers but are hidden visually; toggle reports state", () => {
    const onToggle = vi.fn();
    render(
      <Sidebar
        label="Main"
        brand={<b>Mark</b>}
        items={items}
        collapsed
        onToggle={onToggle}
        toggleLabel="Expand sidebar"
      />,
    );
    const link = screen.getByRole("link", { name: /Today/ });
    expect(link.getAttribute("aria-current")).toBe("page");
    const label = Array.from(link.querySelectorAll("span")).find((n) => n.textContent === "Today")!;
    expect(label.className).toContain("sr-only");
    expect(document.querySelector("aside")!.getAttribute("data-collapsed")).toBe("true");
    const btn = screen.getByRole("button", { name: "Expand sidebar" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });
  it("expanded: labels are visible", () => {
    render(<Sidebar label="Main" brand="x" items={items} onToggle={() => {}} toggleLabel="Collapse sidebar" />);
    const label = screen.getAllByText("Today")[0]!;
    expect(label.className).not.toContain("sr-only");
    expect(screen.getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Surface and Kicker", () => {
  it("renders the card recipe, an inset tone and a custom element", () => {
    render(
      <Surface as="section" tone="inset" pad="lg" data-testid="s">
        x
      </Surface>,
    );
    const el = screen.getByTestId("s");
    expect(el.tagName).toBe("SECTION");
    expect(el.className).toContain("bg-surface-2");
    expect(el.className).toContain("p-6");
  });
  it("Kicker uses the kicker utility", () => {
    render(<Kicker>Source</Kicker>);
    expect(screen.getByText("Source").className).toContain("kicker");
  });
});

describe("ProgressBar, StatusDot, PageContainer", () => {
  it("exposes progressbar semantics and clamps the width", () => {
    render(<ProgressBar value={150} label="Analysed" />);
    const bar = screen.getByRole("progressbar", { name: "Analysed" });
    expect(bar.getAttribute("aria-valuenow")).toBe("150");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
  });
  it("StatusDot always has a text label", () => {
    render(<StatusDot tone="urgent" label="Urgent" />);
    expect(screen.getByText("Urgent").className).toContain("sr-only");
  });
  it("PageContainer picks the narrow width", () => {
    const { container } = render(<PageContainer width="narrow">x</PageContainer>);
    expect((container.firstElementChild as HTMLElement).className).toContain("--ts-page-narrow");
  });
});

describe("Tabs", () => {
  const items = [
    { id: "a", label: "One", count: 2 },
    { id: "b", label: "Two" },
    { id: "c", label: "Three" },
  ];
  it("uses ARIA tabs with a roving tabindex and arrow keys", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} label="Sections" />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeTruthy();
    const [a, b] = screen.getAllByRole("tab");
    expect(a!.getAttribute("aria-selected")).toBe("true");
    expect(a!.getAttribute("tabindex")).toBe("0");
    expect(b!.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(a!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    fireEvent.keyDown(a!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(a!, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(a!, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });
});

describe("Disclosure", () => {
  it("toggles aria-expanded", () => {
    render(<Disclosure summary="Details">Body</Disclosure>);
    const btn = screen.getByRole("button", { name: "Details" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Menu", () => {
  it("opens, moves with arrows, selects, and closes with Escape returning focus", () => {
    const onSelect = vi.fn();
    render(
      <Menu
        label="More actions"
        items={[
          { id: "a", label: "Edit", onSelect },
          { id: "b", label: "Delete", danger: true, onSelect: () => {} },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    const [edit, del] = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(del);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it("closes on a click outside", () => {
    render(
      <div>
        <Menu label="More" items={[{ id: "a", label: "Edit", onSelect: () => {} }]} />
        <p>elsewhere</p>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Skeleton", () => {
  it("renders the requested number of rows", () => {
    const { container } = render(<Skeleton label="Loading" variant="rows" rows={4} />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expect(container.querySelectorAll(".rounded-card").length).toBe(4);
  });
});

describe("Chip", () => {
  it("is a button with a bigger tap area only when interactive", () => {
    const onClick = vi.fn();
    render(
      <Chip onClick={onClick} pressed>
        Filter
      </Chip>,
    );
    const btn = screen.getByRole("button", { name: "Filter" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("after:h-11");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    cleanup();
    render(<Chip>Static</Chip>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Toast", () => {
  function Trigger({ tone }: { tone: "error" | "info" }) {
    const toast = useToast();
    return <button onClick={() => toast.show("Boom", tone, { action: { label: "Retry", onClick: onAction } })}>go</button>;
  }
  const onAction = vi.fn();
  it("keeps errors until dismissed, runs the action, and auto-dismisses info", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider dismissLabel="Dismiss">
        <Trigger tone="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("go"));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole("alert").textContent).toContain("Boom");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(
      <ToastProvider dismissLabel="Dismiss">
        <Trigger tone="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(screen.queryByRole("status")).toBeNull();
    vi.useRealTimers();
  });
});

describe("focus trap", () => {
  it("BottomSheet wraps Tab from the last button to the first", () => {
    render(
      <BottomSheet open title="T" primaryLabel="OK" cancelLabel="Cancel" onPrimary={() => {}} onClose={() => {}}>
        body
      </BottomSheet>,
    );
    const buttons = screen.getAllByRole("button");
    const first = buttons.find((b) => screen.getByRole("dialog").contains(b))!;
    const last = buttons.at(-1)!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
  it("ConfirmDialog keeps focus inside on Shift+Tab from the dialog", () => {
    render(
      <ConfirmDialog open title="Sure?" confirmLabel="Yes" cancelLabel="No" onConfirm={() => {}} onCancel={() => {}} />,
    );
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Yes" }));
  });
});
