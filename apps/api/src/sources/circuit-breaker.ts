import { SourceError } from "@terrasight/sources";

export class CircuitOpenError extends SourceError {
  readonly retryInMs: number;
  constructor(key: string, retryInMs: number) {
    // Not retryable: the point is to skip the live call and go straight to cache / fixture / stale.
    super(`is temporarily unavailable, retrying (paused ${Math.ceil(retryInMs / 1000)} s after repeated failures; ${key})`, false);
    this.retryInMs = retryInMs;
    this.name = "CircuitOpenError";
  }
}

export interface BreakerOptions {
  /** Consecutive failures that open the circuit. */
  threshold?: number;
  /** How long a source is skipped once open. */
  cooldownMs?: number;
  now?: () => number;
}

interface State {
  failures: number;
  openUntil: number;
  probing: boolean;
}

/**
 * Circuit breaker per key (source id): after `threshold` consecutive failures the live call is skipped for
 * `cooldownMs`; then one probe call is let through (half-open) — success closes the circuit, failure reopens it.
 * Keeps a dead upstream from costing every field check its full timeout (RFC §5.2).
 */
export class CircuitBreaker {
  private readonly states = new Map<string, State>();
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.threshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  private state(key: string): State {
    let s = this.states.get(key);
    if (!s) this.states.set(key, (s = { failures: 0, openUntil: 0, probing: false }));
    return s;
  }

  /** Milliseconds until a call is allowed again; 0 when calls may go out (closed, or this call is the probe). */
  private waitMs(key: string): number {
    const s = this.state(key);
    if (s.failures < this.threshold) return 0;
    const left = s.openUntil - this.now();
    if (left > 0) return left;
    if (s.probing) return this.cooldownMs; // another call is already probing
    s.probing = true;
    return 0;
  }

  isOpen(key: string): boolean {
    const s = this.state(key);
    return s.failures >= this.threshold && (s.openUntil > this.now() || s.probing);
  }

  success(key: string): void {
    const s = this.state(key);
    s.failures = 0;
    s.probing = false;
  }

  failure(key: string): void {
    const s = this.state(key);
    s.failures += 1;
    s.probing = false;
    if (s.failures >= this.threshold) s.openUntil = this.now() + this.cooldownMs;
  }

  /**
   * Runs `fn` unless the circuit is open (throws CircuitOpenError). A thrown error counts as a failure unless it is a
   * non-retryable SourceError (a 4xx says the request is wrong, not that the source is down); `failed(result)` lets a
   * caller count a returned failure too.
   */
  async run<T>(
    key: string,
    fn: () => Promise<T>,
    failed?: (result: T) => boolean,
    opts: { force?: boolean } = {},
  ): Promise<T> {
    // A manual retry ("Retry" button) probes now: it skips the pause, and its outcome closes or re-opens the circuit.
    const wait = opts.force ? 0 : this.waitMs(key);
    if (wait > 0) throw new CircuitOpenError(key, wait);
    try {
      const result = await fn();
      if (failed?.(result)) this.failure(key);
      else this.success(key);
      return result;
    } catch (e) {
      if (e instanceof SourceError && !e.retryable) this.success(key);
      else this.failure(key);
      throw e;
    }
  }
}
