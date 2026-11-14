"use client";

/** RFC 9457 problem from the API. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Array<{ path: string; message: string }>;
}

export class ApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
  }
  /** Short code from the problem type, e.g. "bad-credentials". */
  get code(): string {
    return this.problem.type.split("/").pop() ?? "error";
  }
  field(path: string): string | undefined {
    return this.problem.errors?.find((e) => e.path === path)?.message;
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: concurrent 401s wait for the same rotation (a second rotation would look like reuse). */
async function refreshSession(fetchImpl: typeof fetch): Promise<boolean> {
  refreshing ??= fetchImpl("/api/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Don't try to refresh on 401 (used by the auth endpoints themselves). */
  noRefresh?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Browser client for `/api/*` (proxied to the API by Next.js, so cookies stay first-party).
 * Adds the CSRF header, parses problem+json, and refreshes the session once on 401.
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const run = () =>
    fetchImpl(path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await run();
  if (res.status === 401 && !opts.noRefresh && (await refreshSession(fetchImpl))) res = await run();
  if (res.status === 204) return undefined as T;
  const isProblem = (res.headers.get("content-type") ?? "").includes("problem+json");
  const data = await res.json().catch(() => null);
  if (!res.ok || isProblem) {
    throw new ApiError(
      data && typeof data === "object" && "status" in data
        ? (data as Problem)
        : { type: "about:blank", title: res.statusText, status: res.status },
    );
  }
  return data as T;
}

/** Active workspace, kept in a cookie (Tech Design §15.2). */
export const WORKSPACE_COOKIE = "ts_ws";

export function setCookie(name: string, value: string, days = 365): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${days * 86400}; SameSite=Lax`;
}
