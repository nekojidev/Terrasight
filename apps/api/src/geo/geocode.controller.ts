import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { USER_AGENT } from "@terrasight/sources";
import { AuthGuard } from "../auth/current-user.js";
import { RateLimitService } from "../auth/rate-limit.js";
import { ProblemException } from "../http/problem.js";

interface NominatimHit {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

/**
 * "Find a place" on the add-field map (design 13). Proxies OpenStreetMap Nominatim so the browser never calls a
 * third party directly; only the typed place name is sent. Nominatim's policy is ≤ 1 request/s with an
 * identifying User-Agent, so requests are rate-limited across the app and cached in memory.
 */
@Controller("geocode")
@UseGuards(AuthGuard)
export class GeocodeController {
  private readonly cache = new Map<string, unknown>();
  constructor(private readonly limits: RateLimitService) {}

  @Get()
  async search(@Query("q") q: string | undefined) {
    const query = (q ?? "").trim().slice(0, 120);
    if (query.length < 2) throw new ProblemException(422, "invalid-input", "Type at least 2 characters");
    const key = query.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    if (!(await this.limits.take("geocode:nominatim", { capacity: 1, refillPerSec: 1 }))) {
      throw new ProblemException(429, "rate-limited", "Searching too fast; try again in a second");
    }
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok)
      throw new ProblemException(
        503,
        "geocoder-unavailable",
        "Place search is unavailable; enter coordinates instead",
      );
    const hits = ((await res.json()) as NominatimHit[]).map((h) => ({
      label: h.display_name,
      lon: Number(h.lon),
      lat: Number(h.lat),
      bbox: h.boundingbox
        ? [
            Number(h.boundingbox[2]),
            Number(h.boundingbox[0]),
            Number(h.boundingbox[3]),
            Number(h.boundingbox[1]),
          ]
        : null,
    }));
    const body = { results: hits, attribution: "© OpenStreetMap contributors" };
    if (this.cache.size > 2_000) this.cache.clear();
    this.cache.set(key, body);
    return body;
  }
}
