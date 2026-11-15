import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scenarioPoolSize } from "./scenarios.service.js";
import { PoolBusyError, WorkerPool, WorkerTimeoutError, type PoolWorker } from "./worker-pool.js";

/** Worker whose jobs the test completes by hand (or fails by emitting error / exit). */
class FakeWorker extends EventEmitter implements PoolWorker {
  jobs: unknown[] = [];
  terminated = false;
  postMessage(v: unknown): void {
    this.jobs.push(v);
  }
  terminate() {
    this.terminated = true;
    return Promise.resolve();
  }
  reply(result: unknown): void {
    this.emit("message", { ok: true, result });
  }
}

function setup(size: number, timeoutMs = 60_000, maxQueue?: number) {
  const made: FakeWorker[] = [];
  const pool = new WorkerPool<string, string>(
    () => {
      const w = new FakeWorker();
      made.push(w);
      return w;
    },
    { size, timeoutMs, maxQueue },
  );
  return { pool, made };
}

afterEach(() => vi.useRealTimers());

describe("scenario worker pool", () => {
  it("never runs more workers than its size; extra jobs queue and run in order", async () => {
    const { pool, made } = setup(2);
    const results = ["a", "b", "c"].map((x) => pool.run(x));
    expect(made).toHaveLength(2);
    expect(pool.queued).toBe(1);
    made[0]!.reply("ra");
    await expect(results[0]).resolves.toBe("ra");
    expect(made[0]!.jobs).toEqual(["a", "c"]); // the freed worker takes the queued job
    made[1]!.reply("rb");
    made[0]!.reply("rc");
    await expect(Promise.all(results)).resolves.toEqual(["ra", "rb", "rc"]);
    expect(made).toHaveLength(2); // workers were reused, none spawned per run
    expect(pool.queued).toBe(0);
  });

  it("rejects at once when a worker errors, and replaces it for the next job", async () => {
    const { pool, made } = setup(1);
    const first = pool.run("a");
    const second = pool.run("b");
    made[0]!.emit("error", new Error("out of memory"));
    await expect(first).rejects.toThrow("out of memory");
    expect(made[0]!.terminated).toBe(true);
    expect(made).toHaveLength(2); // replacement picked up the queued job
    made[1]!.reply("rb");
    await expect(second).resolves.toBe("rb");
  });

  it("rejects at once when a worker exits mid-job (no 60 s wait)", async () => {
    vi.useFakeTimers();
    const { pool, made } = setup(1, 60_000);
    const job = pool.run("a");
    const settled = expect(job).rejects.toThrow("worker exited (code 1)");
    made[0]!.emit("exit", 1);
    await settled;
    vi.advanceTimersByTime(0);
    expect(pool.workers).toBe(0);
  });

  it("times a job out, terminates that worker and keeps serving", async () => {
    vi.useFakeTimers();
    const { pool, made } = setup(1, 1000);
    const slow = pool.run("slow");
    const next = pool.run("next");
    const rejected = expect(slow).rejects.toBeInstanceOf(WorkerTimeoutError);
    vi.advanceTimersByTime(1000);
    await rejected;
    expect(made[0]!.terminated).toBe(true);
    made[1]!.reply("done");
    await expect(next).resolves.toBe("done");
  });

  it("a worker that reports an error rejects the job but stays in the pool", async () => {
    const { pool, made } = setup(1);
    const job = pool.run("a");
    made[0]!.emit("message", { ok: false, error: "bad input" });
    await expect(job).rejects.toThrow("bad input");
    const again = pool.run("b");
    expect(made).toHaveLength(1);
    made[0]!.reply("rb");
    await expect(again).resolves.toBe("rb");
  });

  it("refuses new jobs when the queue is full and rejects everything on close", async () => {
    const { pool } = setup(1, 60_000, 1);
    const running = pool.run("a");
    const queued = pool.run("b");
    await expect(pool.run("c")).rejects.toBeInstanceOf(PoolBusyError);
    const closed = Promise.allSettled([running, queued]);
    await pool.close();
    expect((await closed).every((r) => r.status === "rejected")).toBe(true);
    await expect(pool.run("d")).rejects.toThrow("closed");
  });

  it("sizes itself from cores minus one with an env override", () => {
    expect(scenarioPoolSize("3")).toBe(3);
    expect(scenarioPoolSize("0")).toBeGreaterThanOrEqual(1);
    expect(scenarioPoolSize(undefined)).toBeGreaterThanOrEqual(1);
  });
});
