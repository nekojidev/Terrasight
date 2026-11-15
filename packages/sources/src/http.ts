import { SourceError } from "./types.js";

/** Generic client name, no personal contact details (privacy rule; NWS and others ask for a User-Agent). */
export const USER_AGENT = "Terrasight/0.1 (agronomy decision support; +https://terrasight.app)";

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  fetch: typeof fetch;
  /** Per-request timeout; the task as a whole has its own (~20 s, RFC D1). */
  timeoutMs?: number;
}

/** fetch with a timeout and errors classified as retryable (5xx, 429, network) or not (4xx). */
export async function http(url: string, opts: HttpOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = AbortSignal.any([opts.signal, timeout]);
  let res: Response;
  try {
    res = await opts.fetch(url, {
      method: opts.method ?? "GET",
      headers: { "User-Agent": USER_AGENT, ...opts.headers },
      body: opts.body,
      signal,
    });
  } catch (e) {
    const err = e as Error;
    throw new SourceError(
      timeout.aborted ? "did not respond in time" : `network error (${err.message})`,
      true,
    );
  }
  if (res.status === 429 || res.status >= 500) throw new SourceError(`responded ${res.status}`, true);
  if (!res.ok) throw new SourceError(`responded ${res.status}`, false);
  return res;
}

export async function httpJson<T>(url: string, opts: HttpOptions): Promise<T> {
  const res = await http(url, { ...opts, headers: { Accept: "application/json", ...opts.headers } });
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError("returned invalid JSON", true);
  }
}

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  /** First backoff; doubles each retry (plus up to 25 % jitter). */
  baseMs?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Runs `fn`, retrying with exponential backoff while it throws something retryable (a retryable SourceError such as
 * 429 / 5xx / timeout, or any non-SourceError such as a dropped range request). A non-retryable SourceError and an
 * aborted signal end it at once; the last error is rethrown.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => wait(ms, opts.signal));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = e instanceof SourceError ? e.retryable : true;
      if (!retryable || attempt + 1 >= attempts || opts.signal?.aborted) throw e;
      await sleep(base * 2 ** attempt * (1 + Math.random() * 0.25));
    }
  }
}
