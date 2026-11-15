import { SourceError } from "@terrasight/sources";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryBuckets, waitFor, WaitTimeoutError } from "../auth/rate-limit.js";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";

afterEach(() => vi.useRealTimers());

describe("circuit breaker per source", () => {
  const boom = () => Promise.reject(new SourceError("responded 503", true));

  function make() {
    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 10_000, now: () => t });
    return { breaker, advance: (ms: number) => (t += ms) };
  }

  it("opens after K consecutive failures and skips the live call for T seconds", async () => {
    const { breaker, advance } = make();
    const live = vi.fn(boom);
    for (let i = 0; i < 3; i++) await expect(breaker.run("power", live)).rejects.toThrow("503");
    expect(live).toHaveBeenCalledTimes(3);
    await expect(breaker.run("power", live)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(live).toHaveBeenCalledTimes(3); // not called while open
    advance(9_999);
    await expect(breaker.run("power", live)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(breaker.isOpen("power")).toBe(true);
  });

  it("the open error is not retryable, so callers go straight to fixture / stale", async () => {
    const { breaker } = make();
    for (let i = 0; i < 3; i++) await breaker.run("power", boom).catch(() => undefined);
    const err = await breaker.run("power", boom).catch((e: unknown) => e as SourceError);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).retryable).toBe(false);
  });

  it("is per source: one dead source does not stop the others", async () => {
    const { breaker } = make();
    for (let i = 0; i < 3; i++) await breaker.run("power", boom).catch(() => undefined);
    await expect(breaker.run("ssurgo", async () => "ok")).resolves.toBe("ok");
  });

  it("lets one probe through after the cooldown; success closes it, failure reopens it", async () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 3; i++) await breaker.run("power", boom).catch(() => undefined);
    advance(10_000);
    let release!: () => void;
    const probe = breaker.run("power", () => new Promise<string>((r) => (release = () => r("ok"))));
    await expect(breaker.run("power", async () => "second")).rejects.toBeInstanceOf(CircuitOpenError); // one probe only
    release();
    await expect(probe).resolves.toBe("ok");
    expect(breaker.isOpen("power")).toBe(false);

    for (let i = 0; i < 3; i++) await breaker.run("power", boom).catch(() => undefined);
    advance(10_000);
    await breaker.run("power", boom).catch(() => undefined); // failed probe
    await expect(breaker.run("power", async () => "x")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("a success resets the count; a 4xx or non-retryable error does not count; a failed result does", async () => {
    const { breaker } = make();
    await breaker.run("a", boom).catch(() => undefined);
    await breaker.run("a", boom).catch(() => undefined);
    await breaker.run("a", async () => "ok");
    await breaker.run("a", boom).catch(() => undefined);
    expect(breaker.isOpen("a")).toBe(false);
    for (let i = 0; i < 5; i++)
      await breaker.run("b", () => Promise.reject(new SourceError("responded 404", false))).catch(() => undefined);
    expect(breaker.isOpen("b")).toBe(false);
    for (let i = 0; i < 3; i++) await breaker.run("c", async () => ({ status: "failed" }), (r) => r.status === "failed");
    expect(breaker.isOpen("c")).toBe(true);
  });
});

describe("bounded waits for rate-limit tokens", () => {
  it("returns as soon as a token is available", async () => {
    vi.useFakeTimers();
    const attempts = [false, false, true];
    const p = waitFor(async () => attempts.shift()!, 250, 60_000, "x");
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeUndefined();
  });

  it("gives up with WaitTimeoutError instead of holding a worker slot forever", async () => {
    vi.useFakeTimers();
    const p = waitFor(async () => false, 250, 1_000, "rate limit source:power");
    const settled = expect(p).rejects.toBeInstanceOf(WaitTimeoutError);
    await vi.advanceTimersByTimeAsync(1_500);
    await settled;
  });

  it("works against a starved memory bucket", async () => {
    vi.useFakeTimers();
    const buckets = new MemoryBuckets(Date.now);
    const spec = { capacity: 2, refillPerSec: 0.0001 };
    expect(buckets.take("k", spec)).toBe(true); // capacity 2 -> 1 token locally; drain it
    const p = waitFor(async () => buckets.take("k", spec), 200, 600, "k");
    const settled = expect(p).rejects.toThrow("gave up waiting");
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
  });
});
