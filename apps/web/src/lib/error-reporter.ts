/**
 * Tiny browser error reporter (no SDK): active only when NEXT_PUBLIC_SENTRY_DSN is set at build time.
 * Sends window.onerror / unhandledrejection to Sentry's envelope endpoint, at most 5 events per page load.
 */
export interface ParsedDsn {
  url: string;
  key: string;
}

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, "");
    if (!u.username || !project) return null;
    return {
      url: `${u.protocol}//${u.host}/api/${project}/envelope/?sentry_key=${u.username}&sentry_version=7`,
      key: u.username,
    };
  } catch {
    return null;
  }
}

export function buildEnvelope(
  dsn: string,
  error: { name: string; message: string; stack?: string },
  page: string,
): string {
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: process.env.NODE_ENV,
    request: { url: page },
    exception: { values: [{ type: error.name, value: error.message, stacktrace: undefined }] },
    extra: { stack: error.stack?.slice(0, 4000) },
  };
  return [
    JSON.stringify({ event_id: eventId, dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

let installed = false;

export function installErrorReporter(dsn = process.env.NEXT_PUBLIC_SENTRY_DSN): void {
  const parsed = parseDsn(dsn);
  if (!parsed || !dsn || installed || typeof window === "undefined") return;
  installed = true;
  let sent = 0;
  const report = (raw: unknown) => {
    if (sent >= 5) return;
    sent += 1;
    const e = raw instanceof Error ? raw : new Error(typeof raw === "string" ? raw : "Unknown error");
    try {
      void fetch(parsed.url, {
        method: "POST",
        body: buildEnvelope(dsn, e, window.location.origin + window.location.pathname),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* never break the page */
    }
  };
  window.addEventListener("error", (ev) => report(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => report(ev.reason));
}
