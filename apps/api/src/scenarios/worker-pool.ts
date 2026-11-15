/** The slice of `worker_threads.Worker` the pool uses; tests pass a fake. */
export interface PoolWorker {
  postMessage(value: unknown): void;
  on(event: "message", fn: (value: unknown) => void): unknown;
  on(event: "error", fn: (err: Error) => void): unknown;
  on(event: "exit", fn: (code: number) => void): unknown;
  terminate(): Promise<unknown> | unknown;
  unref?(): void;
}

/** What a worker posts back: either a result or the error it caught. */
export type PoolReply<O> = { ok: true; result: O } | { ok: false; error: string };

export class WorkerTimeoutError extends Error {
  constructor(ms: number) {
    super(`worker did not answer within ${Math.round(ms / 1000)} s`);
    this.name = "WorkerTimeoutError";
  }
}

export class PoolBusyError extends Error {
  constructor() {
    super("worker pool queue is full");
    this.name = "PoolBusyError";
  }
}

export interface PoolOptions {
  size: number;
  /** Per job, counted from the moment a worker starts it (not while queued). */
  timeoutMs: number;
  maxQueue?: number;
}

interface Job<I, O> {
  input: I;
  resolve: (o: O) => void;
  reject: (e: Error) => void;
}

interface Slot<I, O> {
  worker: PoolWorker;
  job: Job<I, O> | null;
  timer: NodeJS.Timeout | null;
  dead: boolean;
}

/**
 * Fixed-size pool of reusable workers with a FIFO queue (Tech Design §9.1). Workers are created lazily up to
 * `size`, reused between jobs, and replaced when they die: an `error` or `exit` while a job runs rejects that job
 * at once (no waiting for the timeout); a timed-out worker is terminated and replaced.
 */
export class WorkerPool<I, O> {
  private readonly slots = new Set<Slot<I, O>>();
  private readonly queue: Array<Job<I, O>> = [];
  private closed = false;

  constructor(
    private readonly factory: () => PoolWorker,
    private readonly opts: PoolOptions,
  ) {}

  get workers(): number {
    return this.slots.size;
  }
  get queued(): number {
    return this.queue.length;
  }
  get busy(): number {
    return [...this.slots].filter((s) => s.job).length;
  }

  run(input: I): Promise<O> {
    if (this.closed) return Promise.reject(new Error("worker pool is closed"));
    if (this.queue.length >= (this.opts.maxQueue ?? 100)) return Promise.reject(new PoolBusyError());
    return new Promise<O>((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.queue.length) {
      let slot = [...this.slots].find((s) => !s.job);
      if (!slot) {
        if (this.slots.size >= this.opts.size) return;
        try {
          slot = this.spawn();
        } catch (e) {
          this.queue.shift()!.reject(e as Error);
          continue;
        }
      }
      const job = this.queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(() => {
        this.retire(slot, new WorkerTimeoutError(this.opts.timeoutMs));
      }, this.opts.timeoutMs);
      try {
        slot.worker.postMessage(job.input);
      } catch (e) {
        this.retire(slot, e as Error);
      }
    }
  }

  private spawn(): Slot<I, O> {
    const worker = this.factory();
    worker.unref?.();
    const slot: Slot<I, O> = { worker, job: null, timer: null, dead: false };
    worker.on("message", (value) => {
      const job = slot.job;
      if (!job || slot.dead) return;
      if (slot.timer) clearTimeout(slot.timer);
      slot.job = null;
      slot.timer = null;
      const reply = value as PoolReply<O>;
      if (reply.ok) job.resolve(reply.result);
      else job.reject(new Error(reply.error));
      this.pump();
    });
    worker.on("error", (err) => this.retire(slot, err));
    worker.on("exit", (code) => this.retire(slot, new Error(`worker exited (code ${code})`), true));
    this.slots.add(slot);
    return slot;
  }

  /** Removes a worker from the pool (it is replaced on demand) and fails the job it was running, if any. */
  private retire(slot: Slot<I, O>, reason: Error, exited = false): void {
    if (slot.dead) return;
    slot.dead = true;
    if (slot.timer) clearTimeout(slot.timer);
    this.slots.delete(slot);
    const job = slot.job;
    slot.job = null;
    if (!exited) void Promise.resolve(slot.worker.terminate()).catch(() => undefined);
    if (job) job.reject(reason);
    if (!this.closed) this.pump();
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new Error("worker pool is closed"));
    await Promise.all(
      [...this.slots].map(async (s) => {
        s.dead = true;
        if (s.timer) clearTimeout(s.timer);
        s.job?.reject(new Error("worker pool is closed"));
        await Promise.resolve(s.worker.terminate()).catch(() => undefined);
      }),
    );
    this.slots.clear();
  }
}
