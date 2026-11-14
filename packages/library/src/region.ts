import type { RotationsFile } from "./schemas.js";
import { normaliseAdminCode } from "./admin-aliases.js";

/**
 * RFC §6.3: a field belongs to the first region (in file order) with a rule that matches its centroid.
 * A rule matches when its `admin` list contains the ISO 3166-2 code or the ISO 3166-1 country code,
 * and the centroid lies inside the optional lat / lon bounds (inclusive).
 * Mirrors `region_for` in tools/build_rotations_v2.py; both run data/region-test-points.json.
 */
export function matchRegion(
  rotations: Pick<RotationsFile, "regions">,
  adminCode: string,
  lat: number,
  lon: number,
): string | null {
  const code = normaliseAdminCode(adminCode);
  const country = code.split("-")[0] ?? code;
  for (const [regionId, region] of Object.entries(rotations.regions)) {
    for (const rule of region.match) {
      if (!rule.admin.includes(code) && !rule.admin.includes(country)) continue;
      if (rule.lat && (lat < rule.lat[0] || lat > rule.lat[1])) continue;
      if (rule.lon && (lon < rule.lon[0] || lon > rule.lon[1])) continue;
      return regionId;
    }
  }
  return null;
}
