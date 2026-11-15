export * from "./types.js";
export { http, httpJson, mapLimit, USER_AGENT } from "./http.js";
export { CRS, bboxOf, cellKey, geometryHash, pointInPolygons, project, projectPolygons } from "./geo.js";
export {
  power,
  parsePower,
  powerCell,
  POWER_PARAMETERS,
  POWER_START,
  type DailyWeather,
  type PowerParameter,
} from "./power.js";
export { ssurgo, summariseSoil, type SoilSummary } from "./ssurgo.js";
export { modis, type NdviPoint, type NdviSeries } from "./modis.js";
export { dem, slopes, type Terrain } from "./dem.js";
export {
  cdl,
  samplePoints,
  parseCropScapeValue,
  CDL_FIRST_YEAR,
  type CdlHistory,
  type CdlSeason,
} from "./cdl.js";
export { cdlCrop, cdlName, type CdlCrop } from "./cdl-classes.js";
export { soilgrids, type SoilGridsSummary } from "./others.js";
export { soilFromTexture, textureClass } from "./texture.js";
export { openetAdapter, type EtSeries } from "./openet.js";
export { sentinel2Adapter, parseStats, type S2Ndvi, type S2Result } from "./sentinel2.js";
export {
  forecastCell,
  localHour,
  nextFrostDay,
  nwsForecast,
  openMeteoForecast,
  openMeteoHourly,
  type Forecast,
  type ForecastDay,
  type HourlyForecast,
} from "./forecast.js";
export { openMeteoSeasonal, parseSeasonal, type SeasonalEnsemble } from "./seasonal.js";

import { cdl } from "./cdl.js";
import { dem } from "./dem.js";
import { modis } from "./modis.js";
import { openetAdapter } from "./openet.js";
import { soilgrids } from "./others.js";
import { sentinel2Adapter } from "./sentinel2.js";
import { power } from "./power.js";
import { ssurgo } from "./ssurgo.js";
import type { FieldGeometry, SourceAdapter } from "./types.js";

export interface SourceKeys {
  cdseClientId?: string;
  cdseClientSecret?: string;
  openetApiKey?: string;
}

/** Every adapter, in the order the UI lists them. Keyed sources report "not configured" without their keys. */
export function createAdapters(keys: SourceKeys): SourceAdapter[] {
  return [
    power,
    cdl,
    ssurgo,
    soilgrids,
    modis,
    dem,
    sentinel2Adapter(keys.cdseClientId, keys.cdseClientSecret) as SourceAdapter,
    openetAdapter(keys.openetApiKey) as SourceAdapter,
  ];
}

/** Sources that must arrive before a provisional history can be built (Tech Design §8.1: weather, soil, crops). */
export const ESSENTIAL = new Set(["power", "cdl", "ssurgo", "soilgrids", "modis"]);

export function adaptersFor(field: FieldGeometry, keys: SourceKeys = {}): SourceAdapter[] {
  return createAdapters(keys).filter((a) => a.appliesTo(field));
}

export * from "./zones/index.js";
