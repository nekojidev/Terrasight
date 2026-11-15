import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chip, Disclosure, EmptyState, ErrorCard } from "../index";

afterEach(cleanup);

describe("v6 foundation", () => {
  it("Disclosure shows summaryNote only while closed and supports controlled mode and id", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Disclosure summary="Evidence" summaryNote="3 checks" open={false} onOpenChange={onOpenChange} id="ev">
        body
      </Disclosure>,
    );
    expect(screen.getByText("3 checks")).toBeTruthy();
    expect(document.getElementById("ev")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
    rerender(
      <Disclosure summary="Evidence" summaryNote="3 checks" open onOpenChange={onOpenChange} id="ev">
        body
      </Disclosure>,
    );
    expect(screen.queryByText("3 checks")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("Chip estimate tone is dashed, not orange", () => {
    render(<Chip tone="estimate">Estimate</Chip>);
    const cls = screen.getByText("Estimate").className;
    expect(cls).toContain("border-dashed");
    expect(cls).not.toContain("week");
  });

  it("EmptyState and ErrorCard show what / still / one action", () => {
    const onAction = vi.fn();
    render(
      <EmptyState text="old" what="No fields yet" still="Your plan is saved" actionLabel="Add a field" onAction={onAction} />,
    );
    expect(screen.getByText("No fields yet")).toBeTruthy();
    expect(screen.queryByText("old")).toBeNull();
    expect(screen.getByText("Your plan is saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add a field/ }));
    expect(onAction).toHaveBeenCalled();
    cleanup();
    render(<ErrorCard title="Weather" body="Could not load" still="Showing 06:00" retryLabel="Retry" onRetry={() => {}} />);
    expect(screen.getByText("Could not load")).toBeTruthy();
    expect(screen.getByText("Showing 06:00")).toBeTruthy();
  });

  it("EmptyState without an action renders no button", () => {
    render(<EmptyState text="Nothing here" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
