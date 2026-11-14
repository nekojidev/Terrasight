import { httpJson } from "./http.js";
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

/** All items matching the search, following `next` links. */
export async function stacSearch(
  body: Record<string, unknown>,
  ctx: FetchContext,
  maxItems = 2_000,
): Promise<StacItem[]> {
  const items: StacItem[] = [];
  let request: Record<string, unknown> | null = { limit: 250, ...body };
  while (request && items.length < maxItems) {
    const page: SearchPage = await httpJson<SearchPage>(STAC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: ctx.signal,
      fetch: ctx.fetch,
    });
    items.push(...page.features);
    const next = page.links?.find((l) => l.rel === "next");
    request = next?.body && typeof next.body === "object" ? (next.body as Record<string, unknown>) : null;
  }
  return items;
}

const tokens = new Map<string, { token: string; expires: number }>();

/** Signs a blob href with a (cached) SAS token for its storage account and container. */
export async function signHref(href: string, ctx: FetchContext): Promise<string> {
  const url = new URL(href);
  const account = url.hostname.split(".")[0]!;
  const container = url.pathname.split("/")[1]!;
  const key = `${account}/${container}`;
  const cached = tokens.get(key);
  if (!cached || cached.expires < Date.now() + 5 * 60_000) {
    const r = await httpJson<{ token: string; "msft:expiry"?: string }>(`${SAS}/${key}`, {
      signal: ctx.signal,
      fetch: ctx.fetch,
    });
    tokens.set(key, {
      token: r.token,
      expires: r["msft:expiry"] ? Date.parse(r["msft:expiry"]) : Date.now() + 30 * 60_000,
    });
  }
  return `${href}${href.includes("?") ? "&" : "?"}${tokens.get(key)!.token}`;
}
