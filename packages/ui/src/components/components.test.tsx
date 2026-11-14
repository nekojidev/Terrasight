import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BigNumber, Button, DoneRow, FieldThumb, QueueRow, SeasonStrip } from "../index";

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
