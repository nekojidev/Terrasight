import { Inject, Injectable } from "@nestjs/common";
import { matchRegion, type Library } from "@terrasight/library";
import type { FieldGeometry } from "@terrasight/sources";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";

export const MIN_AREA_HA = 1;
export const MAX_AREA_HA = 5_000;

export interface GeoJsonPolygonal {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface FieldPlace {
  areaHa: number;
  centroid: { lon: number; lat: number };
  bbox: [number, number, number, number];
  adminCode: string | null;
  country: string | null;
  countyName: string | null;
  /** UI region (PD §9): "Finney County, KS", else the admin-1 name. */
  placeLabel: string | null;
  regionId: string | null;
  tier: "A" | "B" | "C";
  /** Normalised MultiPolygon, WGS84. */
  multipolygon: number[][][][];
}

/** Geometry checks and offline reverse geocoding on the loaded boundaries (Tech Design §6.3–§6.4). */
@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {}

  async place(geometry: GeoJsonPolygonal): Promise<FieldPlace> {
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
      throw new ProblemException(422, "invalid-geometry", "The boundary must be a polygon");
    }
    const json = JSON.stringify(geometry);
    const rows = await this.prisma.system.$queryRaw<
      Array<{
        valid: boolean;
        reason: string;
        area_ha: number;
        lon: number;
        lat: number;
        xmin: number;
        ymin: number;
        xmax: number;
        ymax: number;
        mp: string;
        code: string | null;
        admin_name: string | null;
        country: string | null;
        county: string | null;
        state_code: string | null;
      }>
    >`
      WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326) AS geom),
           f AS (SELECT geom, ST_IsValid(geom) AS valid, ST_IsValidReason(geom) AS reason, ST_PointOnSurface(geom) AS c FROM g)
      SELECT f.valid, f.reason,
             ST_Area(f.geom::geography) / 10000 AS area_ha,
             ST_X(ST_Centroid(f.geom)) AS lon, ST_Y(ST_Centroid(f.geom)) AS lat,
             ST_XMin(f.geom) AS xmin, ST_YMin(f.geom) AS ymin, ST_XMax(f.geom) AS xmax, ST_YMax(f.geom) AS ymax,
             ST_AsGeoJSON(ST_Multi(f.geom), 7) AS mp,
             a.code, a.name AS admin_name, a.country, u.name AS county, u.state_code
      FROM f
      LEFT JOIN LATERAL (SELECT code, name, country FROM admin_areas WHERE ST_Contains(geom, f.c) LIMIT 1) a ON true
      LEFT JOIN LATERAL (SELECT name, state_code FROM us_counties WHERE ST_Contains(geom, f.c) LIMIT 1) u ON true`;
    const r = rows[0];
    if (!r) throw new ProblemException(422, "invalid-geometry");
    if (!r.valid)
      throw new ProblemException(422, "invalid-geometry", `The boundary is not valid: ${r.reason}`);
    if (r.area_ha < MIN_AREA_HA || r.area_ha > MAX_AREA_HA) {
      throw new ProblemException(
        422,
        "field-size",
        `A field must be between ${MIN_AREA_HA} and ${MAX_AREA_HA} ha`,
      );
    }
    const regionId = r.code ? matchRegion(this.lib.rotations, r.code, r.lat, r.lon) : null;
    return {
      areaHa: Math.round(r.area_ha * 100) / 100,
      centroid: { lon: r.lon, lat: r.lat },
      bbox: [r.xmin, r.ymin, r.xmax, r.ymax],
      adminCode: r.code,
      country: r.country,
      countyName: r.county,
      placeLabel: r.county ? `${r.county}, ${r.state_code}` : r.admin_name,
      regionId,
      tier: this.tier(regionId, r.country),
      multipolygon: (JSON.parse(r.mp) as { coordinates: number[][][][] }).coordinates,
    };
  }

  /** Data tier (PD §8): the region's tier; outside the library, US = A, tier-B countries = B, else C. */
  tier(regionId: string | null, country: string | null): "A" | "B" | "C" {
    if (regionId) return this.lib.rotations.regions[regionId]!.tier;
    if (country === "US") return "A";
    const tierB = Object.values(this.lib.rotations.regions)
      .filter((r) => r.tier === "B")
      .flatMap((r) => r.countries);
    return country && tierB.includes(country) ? "B" : "C";
  }

  /** The adapters' view of a stored field. */
  async fieldGeometry(fieldId: string): Promise<FieldGeometry> {
    const rows = await this.prisma.system.$queryRaw<
      Array<{
        mp: string;
        lon: number;
        lat: number;
        xmin: number;
        ymin: number;
        xmax: number;
        ymax: number;
        country: string | null;
      }>
    >`
      SELECT ST_AsGeoJSON(geom, 7) AS mp, ST_X(centroid) AS lon, ST_Y(centroid) AS lat,
             ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax, country
      FROM fields WHERE id = ${fieldId}::uuid`;
    const r = rows[0];
    if (!r) throw new Error(`field ${fieldId} not found`);
    return {
      polygons: (JSON.parse(r.mp) as { coordinates: number[][][][] }).coordinates,
      centroid: { lon: r.lon, lat: r.lat },
      bbox: [r.xmin, r.ymin, r.xmax, r.ymax],
      country: r.country,
    };
  }
}
