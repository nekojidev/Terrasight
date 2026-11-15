/** Optional error reporting. Does nothing unless SENTRY_DSN is set; @sentry/node is then loaded on demand. */
type SentryNode = typeof import("@sentry/node");

let sentry: SentryNode | null = null;

export async function initSentry(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    const mod = await import("@sentry/node");
    mod.init({
      dsn,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
      release: env.SENTRY_RELEASE,
      // Errors only: no tracing (PII is off by default in this SDK).
      tracesSampleRate: 0,
    });
    sentry = mod;
    return true;
  } catch {
    return false;
  }
}

/** Reports an unexpected error (5xx, a consumer that gave up). Never throws. */
export function captureException(
  error: unknown,
  context: Record<string, string | number | undefined> = {},
): void {
  const s = sentry;
  if (!s) return;
  try {
    s.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) if (v !== undefined) scope.setTag(k, String(v));
      s.captureException(error);
    });
  } catch {
    /* reporting must never break the request or the consumer */
  }
}
