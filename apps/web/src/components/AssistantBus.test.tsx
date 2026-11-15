import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssistantBusProvider, useAssistantAsk, useAssistantBus } from "./AssistantBus";

const wrapper = ({ children }: { children: ReactNode }) => <AssistantBusProvider>{children}</AssistantBusProvider>;

describe("AssistantBus", () => {
  it("returns false with no panel, true when the panel takes the question, and unregisters on unmount", () => {
    const got = vi.fn(() => true);
    const { result } = renderHook(
      () => {
        useAssistantAsk(got);
        return useAssistantBus();
      },
      { wrapper },
    );
    let taken = false;
    act(() => {
      taken = result.current.ask("why?");
    });
    expect(taken).toBe(true);
    expect(got).toHaveBeenCalledWith("why?");

    const lone = renderHook(() => useAssistantBus(), { wrapper });
    expect(lone.result.current.ask("why?")).toBe(false);
  });
});
