import { geometryHash } from "./geo.js";
import { http, httpJson } from "./http.js";
import {
  SourceError,
  type FieldGeometry,
  type FetchContext,
  type SourceAdapter,
  type SourceResult,
} from "./types.js";

/**
 * Sentinel-2 L2A through Copernicus Data Space Ecosystem (Tech Design §13, decision TD-Q2):
 * - NDVI statistics over the field every 5 days for the last 13 months, clouds masked with SCL
 *   (green bridge after wheat harvest, RFC §11.4; current crop stage);
 * - a recent cloud-free true-colour thumbnail for the field card (design 03/04).
 */
export interface S2Ndvi {
  from: string;
  to: string;
  mean: number;
  /** Share of field pixels that were clear. */
  clear: number;
}

export interface S2Result {
  ndvi: S2Ndvi[];
  /** PNG, base64; a cached file in S3 later (Tech Design §13). */
  thumbnailPng: string | null;
}

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

const NDVI_SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }], output: [{ id: "ndvi", bands: 1 }, { id: "dataMask", bands: 1 }] };
}
function evaluatePixel(s) {
  // SCL 3 shadow, 8/9 cloud, 10 cirrus, 11 snow
  var clear = [3, 8, 9, 10, 11].indexOf(s.SCL) < 0;
  var ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  return { ndvi: [ndvi], dataMask: [s.dataMask && clear ? 1 : 0] };
}`;

const TRUE_COLOUR_SCRIPT = `//VERSION=3
function setup() { return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } }; }
function evaluatePixel(s) { return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02, s.dataMask]; }`;

let token: { value: string; expires: number } | null = null;

async function accessToken(id: string, secret: string, ctx: FetchContext): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  }).toString();
  const r = await httpJson<{ access_token?: string; expires_in?: number }>(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: ctx.signal,
    fetch: ctx.fetch,
  });
  if (!r.access_token) throw new SourceError("rejected the credentials", false);
  token = { value: r.access_token, expires: Date.now() + (r.expires_in ?? 600) * 1000 };
  return token.value;
}

function isoMinusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
}

interface StatsResponse {
  data?: Array<{
    interval: { from: string; to: string };
    outputs?: {
      ndvi?: {
        bands?: { B0?: { stats?: { mean?: number | string; sampleCount?: number; noDataCount?: number } } };
      };
    };
  }>;
}

export function parseStats(json: StatsResponse): S2Ndvi[] {
  const out: S2Ndvi[] = [];
  for (const d of json.data ?? []) {
    const s = d.outputs?.ndvi?.bands?.B0?.stats;
    const mean = typeof s?.mean === "number" ? s.mean : Number(s?.mean);
    const total = s?.sampleCount ?? 0;
    const clear = total ? (total - (s?.noDataCount ?? 0)) / total : 0;
    if (!Number.isFinite(mean) || clear < 0.5) continue;
    out.push({
      from: d.interval.from.slice(0, 10),
      to: d.interval.to.slice(0, 10),
      mean: Math.round(mean * 1000) / 1000,
      clear: Math.round(clear * 100) / 100,
    });
  }
  return out;
}

export function sentinel2Adapter(
  clientId: string | undefined,
  clientSecret: string | undefined,
): SourceAdapter<S2Result | null> {
  return {
    id: "sentinel2",
    appliesTo: () => true,
    cacheKey: (field, { today }) => `${geometryHash(field.polygons)}:${today}`,
    async fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<S2Result | null>> {
      if (!clientId || !clientSecret) {
        return {
          status: "failed",
          payload: null,
          dataDate: null,
          attribution: "Copernicus Sentinel-2",
          reason: "Copernicus Sentinel-2 is not configured (CDSE_CLIENT_ID not set)",
        };
      }
      const auth = {
        Authorization: `Bearer ${await accessToken(clientId, clientSecret, ctx)}`,
        "Content-Type": "application/json",
      };
      const geometry = { type: "MultiPolygon", coordinates: field.polygons };
      const from = isoMinusDays(ctx.today, 400);

      const stats = await httpJson<StatsResponse>(STATS_URL, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          input: {
            bounds: { geometry, properties: { crs: CRS84 } },
            data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 80 } }],
          },
          aggregation: {
            timeRange: { from: `${from}T00:00:00Z`, to: `${ctx.today}T23:59:59Z` },
            aggregationInterval: { of: "P5D" },
            evalscript: NDVI_SCRIPT,
            resx: 0.0001,
            resy: 0.0001,
          },
        }),
        signal: ctx.signal,
        fetch: ctx.fetch,
        timeoutMs: 90_000,
      });
      const ndvi = parseStats(stats);

      let thumbnailPng: string | null = null;
      try {
        const res = await http(PROCESS_URL, {
          method: "POST",
          headers: { ...auth, Accept: "image/png" },
          body: JSON.stringify({
            input: {
              bounds: { bbox: field.bbox, properties: { crs: CRS84 } },
              data: [
                {
                  type: "sentinel-2-l2a",
                  dataFilter: {
                    timeRange: {
                      from: `${isoMinusDays(ctx.today, 90)}T00:00:00Z`,
                      to: `${ctx.today}T23:59:59Z`,
                    },
                    mosaickingOrder: "leastCC",
                    maxCloudCoverage: 30,
                  },
                },
              ],
            },
            output: {
              width: 256,
              height: 256,
              responses: [{ identifier: "default", format: { type: "image/png" } }],
            },
            evalscript: TRUE_COLOUR_SCRIPT,
          }),
          signal: ctx.signal,
          fetch: ctx.fetch,
          timeoutMs: 60_000,
        });
        thumbnailPng = Buffer.from(await res.arrayBuffer()).toString("base64");
      } catch {
        // The thumbnail is decorative; NDVI is what models use.
      }

      const status = ndvi.length ? (thumbnailPng ? "done" : "partial") : "failed";
      return {
        status,
        payload: { ndvi, thumbnailPng },
        dataDate: ndvi.at(-1)?.to ?? null,
        attribution:
          "Contains modified Copernicus Sentinel data, processed by Copernicus Data Space Ecosystem",
        ...(status === "done"
          ? {}
          : {
              reason: ndvi.length
                ? "Field thumbnail unavailable"
                : "No clear Sentinel-2 scenes in the last 13 months",
            }),
      };
    },
  };
}
