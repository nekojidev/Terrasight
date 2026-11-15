# Ukraine data coverage (tier C)

Status: 2026-11-15. Real, citable public data only; every number is labelled with its source and as an estimate where it is one. Companion to RFC §6 (sources).

## What a Ukrainian field gets

| Need | Source | Adapter | Resolution | Years | Label in the app |
|---|---|---|---|---|---|
| Weather | NASA POWER | `power` | 0.5° grid | 1981 → | NASA POWER |
| Vegetation | MODIS NDVI (MOD13Q1/MYD13Q1) | `modis` | 250 m | 2000 → | MODIS NDVI |
| Cropland per season | Esri / Impact Observatory 10 m annual land cover (Planetary Computer, CC BY 4.0) | `cropland` | 10 m | 2017–2023 | Land cover (Esri 10 m) |
| Crop type per season | MODIS NDVI curve shape, regional baseline | history builder | 250 m | 2000 → | "estimate" (source `ndvi`) |
| Soil | ISRIC SoilGrids 2.0 (REST) | `soilgrids` | 250 m | static | SoilGrids 250 m, estimate |
| Evapotranspiration, irrigation clue | FAO WaPOR v3 AETI monthly (public COGs, CC BY 4.0) | `wapor` | 300 m | 2018-01 → last complete month | FAO WaPOR, estimate |
| Slope | Copernicus DEM | `dem` | 30 m | static | Copernicus DEM |
| Recent imagery | Sentinel-2 (CDSE) | `sentinel2` | 10 m | recent | Sentinel-2 |
| Oblast yields (context) | State Statistics Service of Ukraine, data.gov.ua (`data/ua-yields.json`) | none (static file) | oblast | 2015–2025 | "oblast average, unverified" |

## Crop history, season by season

| Seasons | Cropland? | Crop type |
|---|---|---|
| 2008–2016 | no map: not known | NDVI estimate (`ndvi`, confidence 0.5) |
| 2017–2023 | Esri land cover: not cropland (< 20 % crop pixels) removes the crop guess; cropland (≥ 50 %) raises confidence to 0.6 | NDVI estimate, never labelled as a mapped crop |
| 2024 → last season | no map yet: not known | NDVI estimate |

The crop type is always an estimate outside the US. The land cover map never names a crop.

## Sources tried for crop type, and why they are not used

| Source | Result |
|---|---|
| ESA WorldCereal 2021 (Zenodo 7875105) | Public, but 15–25 GB deflate-compressed zips per product, no random access: not readable per field at run time. |
| ESA WorldCereal 2021 (Terrascope STAC, per-AEZ COGs) | STAC search works (no login) but the files need a Terrascope account (HTTP 401); the CDSE token is not accepted. |
| ESA WorldCereal v2 (2024 crop type, openEO STAC) | Items point to VITO internal storage (`file:///vitodata/...`); only reachable by running an openEO job (login, processing credits). |
| NASA Harvest Ukraine crop type maps | No public per-season product found on Zenodo, Planetary Computer, CDSE or Terrascope. Only "Ukraine Field Boundary Delineation 2021" (field outlines, no crop). |
| Chen et al. 2024 "Ukraine crop map 2020" (Zenodo 11065080, CC BY 4.0) | Readable by range requests, one year (2020) only, and the sampled windows looked incomplete (large "non-cropland" share in croplands such as Kharkiv and Poltava oblasts). Not adopted: one unverified year; Zenodo also blocks default clients and rate-limits (~133 requests/min). |
| Copernicus HRL Crop Types (EU) | Covers the EU only: no result for Poltava (checked the CDSE STAC). Shown for Prague only. |
| ESA WorldCover 2020 / 2021 | On Planetary Computer; a cropland class from 2020/2021 only, so the Esri annual product (2017–2023) replaces it. |
| GLAD cropland (UMD, 2003–2019) | Download page only (no stable API found); not tested further. |

## Yields

`data/ua-yields.json`: oblast yields of cereals and pulses (total), sugar beet, sunflower, soybean, rapeseed and potato, 2015–2025, from the State Statistics Service open data (data.gov.ua), `verified: false`. Crop codes in the SDMX file were matched to names by exact comparison with the named table "124. Yield of crops by regions" (711 of 712 values equal). Not used for prices or in any model; served as `regionalYields` on the field history for Ukrainian fields. Wheat and maize are not separate because their code names could not be confirmed.

## What public data cannot give today

- A crop-type map per season for Ukraine that is open, citable, readable per field and covers many years (WorldCereal needs an account or processing credits; NASA Harvest maps are not published as an API).
- Field-scale water use: WaPOR is 300 m, so small fields average with their neighbours; it is a different model than OpenET and the app labels it an estimate.
- Prices (NASS / AMS have no Ukrainian equivalent in open data) and wheat / maize yields by oblast.

## Operational notes

- SoilGrids REST (`rest.isric.org`) did not answer from the build network during the 2026-11-15 test (all requests timed out), so the SoilGrids live call was not exercised; the summariser is unit-tested. `files.isric.org` was reachable and serves 250 m tiles and a 1 km global COG as a possible fallback (not built).
- WaPOR reads about 100 small COG windows per field on first fetch (≈ 10 s) and is cached for 30 days (key by month).
