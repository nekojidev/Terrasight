# Competitor analysis — EOSDA Crop Monitoring

|                |                                                                                       |
| -------------- | ------------------------------------------------------------------------------------- |
| **Date**       | 2026-11-14                                                                            |
| **Competitor** | EOSDA Crop Monitoring (EOS Data Analytics), https://eos.com/products/crop-monitoring/ |
| **Purpose**    | Find where Terrasight must match it and where Terrasight wins                         |

## 1. What EOS offers

| Area         | EOS Crop Monitoring                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Imagery      | Sentinel-2 and PlanetScope, cloud- and shadow-filtered, up to 3 m resolution                         |
| Indices      | 10 vegetation indices (NDVI, NDMI, NDRE, MSAVI, RECI…), soil moisture                                |
| Weather      | 14-day forecast, historical weather, cold/heat stress, ground weather stations                       |
| Risks        | Risk notifications; a Risk Map of disease, weather and index risks across fields                     |
| Scouting     | Send scouts to problem zones; mobile app with offline mode, photos and threat notes                  |
| Zoning / VRA | Variable-rate maps for fertiliser, seed, water, pesticide (from indices, elevation, machinery data)  |
| Yield        | Yield and biomass forecast for the next 14 days                                                      |
| Operations   | Field activity log, task assignment and completion                                                   |
| Team         | Role-based team accounts, unlimited team members on the consultant plan                              |
| Reports      | Customisable and automated reports                                                                   |
| Integrations | John Deere Operations Center, API                                                                    |
| Pricing      | Free field monitoring; paid Essential (up to 1,000 ha) and Professional (any area, pay for extra ha) |
| Users        | Growers, agricultural consultants, insurers, plantations                                             |

## 2. Where EOS is weak (our opening)

1. **Data, not decisions.** It gives indices and maps that someone must interpret. EOS's own CSO said in 2019 that satellite monitoring "does not make any self-dependent recommendations" and turns data into information for an analyst (Agribusiness Global, 14 Nov 2019; the product may have changed since).
2. **No AI assistant** is described on the product page.
3. **Generic risks.** One Risk Map; no pest-by-pest models tied to crop history and degree days.
4. **No multi-year planning.** No crop-rotation comparison, no multi-year economics, no "what if the climate shifts".
5. **Clouds block optical data.** A user review notes moisture information may be unavailable at key stages when clouds are present.
6. **Scouting is generic.** Scouts are sent to "problem zones"; results don't feed a pest model.

## 3. How Terrasight is better

|                     | EOS                         | Terrasight                                                                                                        |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Main output         | Indices, maps, risk map     | **A ranked to-do: what to do, where, by when, and why**                                                           |
| Explanation         | Analyst interprets          | **AI assistant (Gemini) explains every recommendation with the field's own data; numbers checked against models** |
| Pests & diseases    | Generic risk map            | **62 pest/disease models with drivers (rotation, degree days, weather) + "scout to confirm"**                     |
| Crop history        | Crop rotation shown as data | **18 seasons used as evidence: corn-after-corn → rootworm, sunflower interval → broomrape**                       |
| Planning            | Season view                 | **Rotation planner: current + 2 alternatives, 5 seasons (2026–2030), 150 weather runs × 10 price scenarios**                  |
| Cloudy weeks        | Optical gaps                | **Model-based water balance (FAO-56)** (SMAP microwave soil moisture dropped in PD v2.13: never used)                  |
| Scouting            | Send scout to a zone        | **Pest-specific checklist (route, counts, photos), offline; the result updates the field's risk**                 |
| Owner communication | Reports                     | **One-tap farmer report: "Done / Not yet / Question" closes the loop**                                            |
| Analysis            | Continuous monitoring       | **Daily automatic check + "Analyze fields" command, season-aware checks**                                         |
| Cost of data        | Commercial imagery tiers    | **Open NASA / USDA / ESA data**                                                                                   |

## 4. Gaps we accept for now (EOS has them)

| EOS feature                   | Terrasight plan                                                                |
| ----------------------------- | ------------------------------------------------------------------------------ |
| 3 m PlanetScope imagery       | Not for the hackathon; Sentinel-2 / MODIS are enough for field-level decisions |
| Variable-rate (VRA) zone maps | Non-goal in v2; later                                                          |
| John Deere integration        | Later; API first                                                               |
| 14-day yield forecast         | Season-level yield from the simulator; short-term forecast later               |
| Activity log                  | Partly covered by tasks + farmer replies                                       |

## 5. Pitch line

> "EOS shows you the field. Terrasight tells you what to do on it — and proves why."

## Sources

- EOSDA Crop Monitoring product page: https://eos.com/products/crop-monitoring/
- EOSDA plans (Essential up to 1,000 ha; Professional): https://eos.com/user-guide/crop-monitoring/account-and-pricing/ , https://eos.com/es/products/crop-monitoring/user-guide/account-and-pricing
- Capterra reviews (clouds limit moisture data): https://www.capterra.com/p/195553/EOS-Crop-Monitoring/reviews/
- G2 product description (scouting, offline mode): https://g2.com/products/eos-crop-monitoring/reviews
- Agribusiness Global interview with EOS CSO, 2019: https://www.agribusinessglobal.com/agrochemicals/the-future-of-satellites-in-precision-agriculture/
