# Third-party notices

Terrasight is built on open data and open-source libraries. This file lists each data source with its terms as we understand them, the attribution we owe, and what to do before a commercial launch. It is a working summary, not legal advice: where a row says **check**, confirm the current terms with the provider before charging customers. Last reviewed 2026-11-15.

The project's own licence is not decided yet (README: "License"); this file does not grant one.

## 1. Data sources and services

| Source | Used for | Terms (summary) | What we must do |
| --- | --- | --- | --- |
| **NASA POWER** (weather from 1981), **MODIS** NDVI (LP DAAC, from 2000), **GPM IMERG** monthly precipitation (GES DISC, GPM_3IMERGM v07, from 2001; DOI 10.5067/GPM/IMERG/3B-MONTH/07) | Weather history, vegetation index, independent rainfall check of POWER (SMAP removed in PD v2.13: never used) | NASA Earth science data are open, no use restrictions. MODIS and GPM via Earthdata need a free login (`EARTHDATA_TOKEN`; for GPM the Earthdata profile must also accept the "NASA GESDISC DATA ARCHIVE" application) | Acknowledge NASA and the data product (POWER: "NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program"); cite product DOIs; do not imply NASA endorsement |
| **USDA NASS Cropland Data Layer (CDL)** | Crop per year, US, 2008+ | US government work, public domain | Credit USDA NASS; do not imply endorsement |
| **USDA NRCS SSURGO** | US soil | US government work, public domain | Credit USDA NRCS |
| **USDA NASS / AMS** | US yields and prices | Public domain; NASS Quick Stats API has a key and fair-use limits | Credit the agency; keep within the API limits |
| **OpenET** | Field water use (evapotranspiration) | Free API with a key and quotas; data published under a CC BY-style open licence with attribution. **Check** the current API terms for commercial use | Attribute "OpenET"; keep the key private (`OPENET_API_KEY`) |
| **ESA Copernicus Sentinel-2** (via Copernicus Data Space Ecosystem) | Field imagery, NDVI, zones (outside the US and as a complement) | Free, full and open under the Copernicus data policy (Regulation (EU) 1159/2013) | "Contains modified Copernicus Sentinel data [year]"; CDSE account terms apply to API access (`CDSE_CLIENT_*`) |
| **Copernicus DEM GLO-30** | Field slope and elevation | Free with attribution | "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved" |
| **EOX Sentinel-2 cloudless 2016** (basemap) | Satellite background for outlining fields | **CC BY 4.0** for the 2016 mosaic. EOX's later years (2017+) are CC BY-NC-SA 4.0, **non-commercial**: do not switch to them for a commercial product. In EOX's WMTS the 2016 layer is `s2cloudless_3857` (title "Sentinel-2 cloudless layer for 2016"); `s2cloudless-2016_3857` does not exist (404). Verified 2026-11-15 | Show "Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)" on every map (`ATTRIBUTION` in `FieldMap.tsx`). Override with `NEXT_PUBLIC_BASEMAP_TILES` only to a source whose terms allow our use. EOX asks for fair use of its public tile server: consider a commercial basemap or own tiles at scale |
| **Open-Meteo** (forecast) | 7–16 day forecast | Free API is **non-commercial** (CC BY 4.0 data, attribution, rate limits). Commercial use needs a paid key (`OPEN_METEO_API_KEY`) | Production must run with the paid key. Attribution "Weather data by Open-Meteo.com" |
| **ECMWF SEAS5 via Open-Meteo** (seasonal outlook) | Seasonal ensemble and monthly anomalies | Copernicus Climate Change Service / ECMWF data, CC BY 4.0, served through Open-Meteo under the same free / paid split | Attribution: "Seasonal forecast by Open-Meteo.com (CC BY 4.0), ECMWF SEAS5 ensemble (Copernicus Climate Change Service)" (already in the data object) |
| **NOAA National Weather Service** | US forecast fallback | US government work, public domain; requires an identifying `User-Agent` | Send a User-Agent with a contact; respect rate limits |
| **OpenStreetMap Nominatim** (address search while adding a field) | Geocoding | OSMF usage policy: max **1 request per second**, an identifying `User-Agent`, cache results, no bulk use; data © OpenStreetMap contributors (**ODbL**) | We rate-limit to 1 req/s across the app (`geocode.controller.ts`), set a User-Agent and cache. Show "© OpenStreetMap contributors" near search results. At production scale use a paid or self-hosted geocoder |
| **Microsoft Planetary Computer** (STAC API) | Land-cover and other collections | Free API for reasonable use; each collection keeps its own licence | Check each collection's licence; use a subscription key if rate limits bite |
| **Esri / Impact Observatory 10 m annual land cover** (`io-lulc-annual-v02`) | Cropland map outside the US | **CC BY 4.0** | "Esri, Impact Observatory, and Microsoft" |
| **FAO WaPOR v3** | Actual evapotranspiration for Ukraine | **CC BY 4.0** (FAO open data) | "FAO WaPOR" with the version; do not imply FAO endorsement |
| **ISRIC SoilGrids 2.0** | Soil outside the US | **CC BY 4.0** | Cite Poggio et al. 2021 / ISRIC – World Soil Information |
| **Natural Earth** | County and admin-1 boundaries for reverse geocoding | **Public domain** | Credit is appreciated, not required ("Made with Natural Earth") |
| **State Statistics Service of Ukraine (Ukrstat)**, via data.gov.ua | Oblast-level yields for Ukraine (`data/ua-yields.json`) | Published as open data on data.gov.ua, normally with attribution. **Check** the licence shown on the dataset page | Credit "State Statistics Service of Ukraine"; keep the source and year on each number |
| **FAOSTAT** (price fallback) | Producer prices when no market price is verified | FAO statistical data; licence terms have changed over time. **Check** (CC BY-NC-SA 3.0 IGO on older releases is non-commercial) | Cite FAOSTAT; keep the fallback labelled in the UI |
| **Google Gemini API** (service, not data) | Assistant and AI-written texts | Google API terms and data-use policy apply to prompts and answers | Do not send personal data; keep the key private (`GEMINI_API_KEY`) |

The "No product ads · open public data: NASA, USDA, ESA and others" stamp in the brief header is part of the design; keep it.

## 2. Library licences (summary)

From `pnpm licenses list --prod` on the production dependency tree (2026-11-15, 491 package entries incl. platform variants):

| Licence | Packages | Notes |
| --- | ---: | --- |
| MIT | 293 | permissive |
| Apache-2.0 | 117 | permissive (patent grant); keep NOTICE files where a package ships one |
| ISC | 37 | permissive |
| BSD-3-Clause / BSD-2-Clause | 24 | permissive; keep the copyright notice |
| BlueOak-1.0.0 | 7 | permissive |
| MIT-style combinations (`MIT OR Apache-2.0`, `Apache-2.0 AND MIT`, `MIT and ISC`, `MIT AND BSD-3-Clause`, `MIT AND Zlib`) | 5 | permissive |
| Unlicense, CC0-1.0, 0BSD | 4 | public-domain style |
| CC-BY-4.0 | 1 | `caniuse-lite` (browser data used by build tools, not shipped to users); attribution |
| EPL-2.0 | 1 | `elkjs` (layout engine); weak copyleft, used unmodified as a library |
| LGPL-3.0-or-later | 1 per platform | `@img/sharp-libvips-*` (native libvips for Next.js image handling, optional, dynamically linked, unmodified) |
| FSL-1.1-Apache-2.0 | 1 | `sentry` 0.49.0, a transitive build-time tool of `@sentry/node`; source-available, converts to Apache-2.0 two years after release; not redistributed in our images |

No GPL or AGPL packages are in the production tree. Re-run `pnpm licenses list --prod --json` after dependency changes and update this table. Full licence texts are in each package under `node_modules` and, for the container images, under `/repo/apps/api/node_modules` and `/app/node_modules`.

Main runtime libraries: `next`, `react` (MIT), `maplibre-gl` (BSD-3-Clause), `lucide-react` (ISC), NestJS (MIT), Prisma (Apache-2.0), `@google/genai` (Apache-2.0), `@sentry/node` (MIT).
