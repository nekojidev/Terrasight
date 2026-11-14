import { afterEach, describe, expect, it, vi } from "vitest";
import { connectStream, MAX_FAILURES_BEFORE_POLLING, POLL_MS, type EventSourceFactory } from "./events";

const WS = "11111111-1111-4111-8111-111111111111";

class FakeSource {
  url: string;
  closed = false;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  listeners = new Map<string, (e: Event) => void>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent as Event);
  }
}

function setup() {
  let source!: FakeSource;
  const factory = ((url: string) => (source = new FakeSource(url))) as unknown as EventSourceFactory;
  const invalidate = vi.fn();
  const ctl = connectStream({ workspaceId: WS, topics: ["brief", "analysis"], invalidate, factory });
  return { ctl, invalidate, source: () => source };
}

afterEach(() => vi.useRealTimers());

describe("connectStream (S-00.05)", () => {
  it("subscribes to the workspace stream with the requested topics", () => {
    const { source } = setup();
    expect(source().url).toBe(`/api/w/${WS}/events?topics=${encodeURIComponent("brief,analysis")}`);
  });

  it("invalidates the topic's queries on each event", () => {
    const { source, invalidate } = setup();
    source().emit("analysis", { type: "analysis.field" });
    expect(invalidate.mock.calls.map((c) => c[0])).toEqual([
      ["analysis", WS],
      ["brief", WS],
    ]);
  });

  it("falls back to polling after repeated errors", () => {
    vi.useFakeTimers();
    const { ctl, source, invalidate } = setup();
    for (let i = 0; i < MAX_FAILURES_BEFORE_POLLING - 1; i++) source().onerror?.(new Event("error"));
    expect(ctl.polling).toBe(false);
    source().onerror?.(new Event("error"));
    expect(ctl.polling).toBe(true);
    expect(source().closed).toBe(true);
    vi.advanceTimersByTime(POLL_MS);
    expect(invalidate).toHaveBeenCalledWith(["brief", WS]);
    ctl.stop();
  });

  it("resets the failure count when the connection opens again", () => {
    const { ctl, source } = setup();
    source().onerror?.(new Event("error"));
    source().onerror?.(new Event("error"));
    source().onopen?.(new Event("open"));
    source().onerror?.(new Event("error"));
    expect(ctl.polling).toBe(false);
  });
});
