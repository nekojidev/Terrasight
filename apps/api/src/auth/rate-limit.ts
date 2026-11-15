import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service.js";

export interface BucketSpec {
  /** Maximum burst. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

/** Atomic token bucket in Redis (Tech Design §13). Returns 1 when a token was taken. */
const LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + (now - ts) / 1000 * refill)
local ok = 0
if tokens >= 1 then tokens = tokens - 1; ok = 1 end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refill * 1000) + 1000)
return ok
`;

/** In-process bucket, used when Redis is absent; runs at half rate because each instance has its own (RFC §5.2). */
export class MemoryBuckets {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  take(key: string, spec: BucketSpec): boolean {
    const capacity = Math.max(1, Math.floor(spec.capacity / 2));
    const refill = spec.refillPerSec / 2;
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, ts: t };
    b.tokens = Math.min(capacity, b.tokens + ((t - b.ts) / 1000) * refill);
    b.ts = t;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.buckets.clear();
    return ok;
  }
}

@Injectable()
export class RateLimitService {
  private readonly memory = new MemoryBuckets();
  constructor(private readonly redis: RedisService) {}

  async take(key: string, spec: BucketSpec): Promise<boolean> {
    if (this.redis.available && this.redis.client) {
      try {
        const r = await this.redis.client.eval(
          LUA,
          1,
          `rl:${key}`,
          spec.capacity,
          spec.refillPerSec,
          Date.now(),
        );
        return r === 1;
      } catch {
        // fall through to the local bucket
      }
    }
    return this.memory.take(key, spec);
  }

  /**
   * Waits for a token, polling every `pollMs`, for at most `maxWaitMs`; then throws instead of holding the caller
   * (a worker slot) indefinitely behind a starved bucket. Callers treat it like any source failure.
   */
  async takeWithin(key: string, spec: BucketSpec, pollMs: number, maxWaitMs = MAX_TOKEN_WAIT_MS): Promise<void> {
    await waitFor(() => this.take(key, spec), pollMs, maxWaitMs, `rate limit ${key}`);
  }
}

/** Longest a gather loop waits for a rate-limit token before giving up. */
export const MAX_TOKEN_WAIT_MS = 60_000;

export class WaitTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`gave up waiting for ${what} after ${Math.round(ms / 1000)} s`);
    this.name = "WaitTimeoutError";
  }
}

/** Polls `attempt` until it returns true, or throws WaitTimeoutError once `maxWaitMs` has passed. */
export async function waitFor(
  attempt: () => Promise<boolean>,
  pollMs: number,
  maxWaitMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (!(await attempt())) {
    if (Date.now() + pollMs > deadline) throw new WaitTimeoutError(what, maxWaitMs);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Sign-in and sign-up: 10 attempts burst, then one every 6 s, per IP and per email. AUTH_RATE_BURST raises the burst
 * for the contract test run only (many sign-ins from one IP); production keeps the default.
 */
export const AUTH_BUCKET: BucketSpec = {
  capacity: Math.max(1, Number(process.env.AUTH_RATE_BURST) || 10),
  refillPerSec: 1 / 6,
};
