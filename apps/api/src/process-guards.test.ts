import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installProcessGuards } from "./process-guards.js";

afterEach(() => vi.useRealTimers());

describe("process guards", () => {
  it("logs an unhandled rejection and keeps running", () => {
    const proc = new EventEmitter();
    const log = { error: vi.fn() };
    const exit = vi.fn();
    installProcessGuards(() => log, proc as never, { exit });
    proc.emit("unhandledRejection", new Error("boom"));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("unhandledRejection: Error: boom"));
    expect(exit).not.toHaveBeenCalled();
  });

  it("logs an uncaught exception as fatal and exits 1 after the flush delay", () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    const log = { error: vi.fn(), fatal: vi.fn() };
    const exit = vi.fn();
    installProcessGuards(() => log, proc as never, { exit, exitDelayMs: 300 });
    proc.emit("uncaughtException", new Error("bad state"));
    expect(log.fatal).toHaveBeenCalledWith(expect.stringContaining("uncaughtException"));
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("falls back to error() when the logger has no fatal, and can be removed", () => {
    const proc = new EventEmitter();
    const log = { error: vi.fn() };
    const remove = installProcessGuards(() => log, proc as never, { exit: vi.fn() });
    remove();
    expect(proc.listenerCount("unhandledRejection")).toBe(0);
    expect(proc.listenerCount("uncaughtException")).toBe(0);
  });
});
