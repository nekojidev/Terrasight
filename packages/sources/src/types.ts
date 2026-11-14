/** A field as the adapters see it: WGS84 GeoJSON plus derived helpers (computed once by the API). */
export interface FieldGeometry {
  /** GeoJSON MultiPolygon coordinates, [lon, lat], rings closed. */
  polygons: number[][][][];
  centroid: { lon: number; lat: number };
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
  /** ISO 3166-1 alpha-2, e.g. "US"; decides which sources apply. */
  country: string | null;
}

export type SourceStatus = "done" | "partial" | "failed";

export interface SourceResult<T = unknown> {
  status: SourceStatus;
  payload: T | null;
  /** Latest date the data covers, ISO yyyy-mm-dd. */
  dataDate: string | null;
  /** Shown on evidence (Tech Design §13). */
  attribution: string;
  /** Plain-language reason for partial / failed, shown in the UI ("SSURGO did not respond, soil data missing"). */
  reason?: string;
}

export interface FetchContext {
  signal: AbortSignal;
  /** Injected fetch (tests use recorded responses). */
  fetch: typeof fetch;
  /** Today in UTC, ISO date; injected for determinism. */
  today: string;
}

/** One adapter per source (Tech Design §13). Adapters do no caching: the gather worker caches by key. */
export interface SourceAdapter<P = unknown> {
  readonly id: SourceId;
  /** Whether this source applies to the field (e.g. CDL and SSURGO only in the US). */
  appliesTo(field: FieldGeometry): boolean;
  /** Cache key parts besides the source id (geometry hash or grid cell, parameters). */
  cacheKey(field: FieldGeometry, ctx: Pick<FetchContext, "today">): string;
  fetch(field: FieldGeometry, ctx: FetchContext): Promise<SourceResult<P>>;
}

export type SourceId = "power" | "cdl" | "ssurgo" | "soilgrids" | "modis" | "dem" | "sentinel2" | "openet";

export class SourceError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SourceError";
  }
}
