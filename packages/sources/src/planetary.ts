import { httpJson, withRetry } from "./http.js";
import type { FetchContext } from "./types.js";

/** Microsoft Planetary Computer: anonymous STAC search + SAS tokens per storage account/container. */
const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token";

export interface StacItem {
  id: string;
  properties: Record<string, unknown> & {
    datetime?: string | null;
    start_datetime?: string;
    end_datetime?: string;
  };
  assets: Record<string, { href: string }>;
  bbox?: number[];
}

interface SearchPage {
  features: StacItem[];
  links?: Array<{ rel: string; body?: unknown; href?: string; method?: string }>;
}

/** All items matching the search, following `next` links. Transient errors (429, 5xx, timeouts) are retried. */
export async function stacSearch(
  body: Record<string, unknown>,
  ctx: FetchContext,
  maxItems = 2_000,
): Promise<StacItem[]> {
  const items: StacItem[] = [];
  let request: Record<string, unknown> | null = { limit: 250, ...body };
  while (request && items.length < maxItems) {
    const payload = JSON.stringify(request);
    const page: SearchPage = await withRetry(
      () =>
        httpJson<SearchPage>(STAC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: ctx.signal,
          fetch: ctx.fetch,
        }),
      { signal: ctx.signal },
    );
    items.push(...page.features);
    const next = page.links?.find((l) => l.rel === "next");
    request = next?.body && typeof next.body === "object" ? (next.body as Record<string, unknown>) : null;
  }
  return items;
}

const tokens = new Map<string, { token: string; expires: number }>();
/** One token request per container at a time: concurrent readers share it (the SAS endpoint answers 429 to bursts). */
const pending = new Map<string, Promise<void>>();

/** For tests: forget cached tokens. */
export function clearSasCache(): void {
  tokens.clear();
  pending.clear();
}

/** Signs a blob href with a (cached) SAS token for its storage account and container. */
export async function signHref(href: string, ctx: FetchContext): Promise<string> {
  const url = new URL(href);
  const account = url.hostname.split(".")[0]!;
  const container = url.pathname.split("/")[1]!;
  const key = `${account}/${container}`;
  const cached = tokens.get(key);
  if (!cached || cached.expires < Date.now() + 5 * 60_000) {
    let request = pending.get(key);
    if (!request) {
      request = withRetry(
        () =>
          httpJson<{ token: string; "msft:expiry"?: string }>(`${SAS}/${key}`, {
            signal: ctx.signal,
            fetch: ctx.fetch,
          }),
        { attempts: 4, baseMs: 700, signal: ctx.signal },
      )
        .then((r) => {
          tokens.set(key, {
            token: r.token,
            expires: r["msft:expiry"] ? Date.parse(r["msft:expiry"]) : Date.now() + 30 * 60_000,
          });
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
    }
    await request;
  }
  return `${href}${href.includes("?") ? "&" : "?"}${tokens.get(key)!.token}`;
}
