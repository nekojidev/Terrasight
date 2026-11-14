/**
 * FAO-56 Penman-Monteith reference evapotranspiration, daily (Allen et al. 1998, Eq. 6 and Chapter 3).
 */

/** Day of year, 1–366. */
export function dayOfYear(iso: string): number {
  const d = Date.parse(`${iso}T00:00:00Z`);
  return Math.floor((d - Date.parse(`${iso.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000) + 1;
}

/** Extraterrestrial radiation Ra, MJ m⁻² day⁻¹ (FAO-56 Eq. 21). */
export function extraterrestrialRadiation(latDeg: number, doy: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * doy);
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return (
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
  );
}

/** Saturation vapour pressure, kPa (Eq. 11). */
export const es = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

export interface Et0Input {
  tmin: number;
  tmax: number;
  /** Relative humidity: either RHmin and RHmax, or the daily mean. */
  rhMin?: number;
  rhMax?: number;
  rhMean?: number;
  /** Solar radiation Rs, MJ m⁻² day⁻¹. */
  rs: number;
  /** Wind speed at 2 m, m/s. */
  u2: number;
  elevationM: number;
  latDeg: number;
  doy: number;
}

/** ET₀, mm/day (FAO-56 Eq. 6). Net longwave per Eq. 39, Rso per Eq. 37, albedo 0.23, G = 0 for daily steps. */
export function et0PenmanMonteith(x: Et0Input): number {
  const tmean = (x.tmax + x.tmin) / 2;
  const P = 101.3 * ((293 - 0.0065 * x.elevationM) / 293) ** 5.26; // Eq. 7
  const gamma = 0.000665 * P; // Eq. 8
  const delta = (4098 * es(tmean)) / (tmean + 237.3) ** 2; // Eq. 13
  const esMean = (es(x.tmax) + es(x.tmin)) / 2; // Eq. 12
  const ea =
    x.rhMin !== undefined && x.rhMax !== undefined
      ? (es(x.tmin) * (x.rhMax / 100) + es(x.tmax) * (x.rhMin / 100)) / 2 // Eq. 17
      : ((x.rhMean ?? 60) / 100) * esMean; // Eq. 19
  const ra = extraterrestrialRadiation(x.latDeg, x.doy);
  const rso = (0.75 + 2e-5 * x.elevationM) * ra; // Eq. 37
  const rns = (1 - 0.23) * x.rs; // Eq. 38
  const sigma = 4.903e-9;
  const ratio = Math.min(1, x.rs / rso);
  const rnl =
    sigma *
    (((x.tmax + 273.16) ** 4 + (x.tmin + 273.16) ** 4) / 2) *
    (0.34 - 0.14 * Math.sqrt(ea)) *
    (1.35 * ratio - 0.35); // Eq. 39
  const rn = rns - rnl;
  const et0 =
    (0.408 * delta * rn + gamma * (900 / (tmean + 273)) * x.u2 * (esMean - ea)) /
    (delta + gamma * (1 + 0.34 * x.u2));
  return Math.max(0, et0);
}

/** Hargreaves ET₀ (FAO-56 Eq. 52), used when radiation or humidity is missing. */
export function et0Hargreaves(tmin: number, tmax: number, latDeg: number, doy: number): number {
  const ra = extraterrestrialRadiation(latDeg, doy);
  const tmean = (tmin + tmax) / 2;
  return Math.max(0, 0.0023 * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * 0.408 * ra);
}
