# NASA Space Apps 2026: Project page texts (paste-ready)

Challenge: **Field Shift: Adapting Farms with NASA Data**. Team: **Vibe-Kitties** (Kyiv). Team member: Oleksandr Baranovskyi.
All numbers below were copied from the running application on 2026-11-15 (North quarter, dryland, Finney County, Kansas; Pivot 14, Finney County, Kansas; the farm-level stress test). Re-check them if the data changes before you submit.

---

## Project Name

Terrasight

---

## High-Level Project Summary

Your field has shifted. Has your plan? Terrasight is an AI assistant for agronomists that turns NASA and partner open data into a daily, explained decision for every field, and a five-season rotation plan (2026–2030). It answers the challenge directly: 45 years of NASA POWER weather show, for a field in Kansas, a growing season 1.3°F warmer and a first autumn frost 8 days later, and each rotation is then tested on 150 weather runs and 10 price scenarios. What sets it apart is the proof attached: a page that compares the model with official yields and satellite greenness (r = 0.71 and 0.82 over 10 years), lists the years it missed, and says where it cannot be checked. Farmers get a simple shared report; owners approve decisions in one tap.

---

## Link to Project Demo

Provide **one** public link, without login. We offer two demos; each fits the official limit on its own (video 29.4 s; deck 7 slides).

- Video (30 seconds or less), AI-generated narration disclosed on the end card and in the file metadata: `https://github.com/nekojidev/Terrasight/blob/main/demo/terrasight-30s.mp4` (raw file: `https://github.com/nekojidev/Terrasight/raw/main/demo/terrasight-30s.mp4`). Captions: `demo/terrasight-30s.srt` in the same folder.
- Slide deck (7 slides, English): `https://github.com/nekojidev/Terrasight/blob/main/demo/terrasight-deck.pdf`

Which one goes in the field: use the video as "Link to Project Demo" and the deck as an extra link in the Detailed Description if the form allows it. Do not exceed the limits: submitting either one alone is valid.

## Link to Final Project

- Repository (public, source code and docs): `https://github.com/nekojidev/Terrasight`
- Public page without login, if a host exists: `<FILL IN: https://…/explore>` (the page "/explore" shows the climate shift for any clicked point on Earth; no account). If there is no public host yet, leave this line out and point to the repository only.

The judges must be able to open every link without logging in. Test them in a private browser window.

---

## Detailed Project Description

**What it does.** Terrasight is an AI assistant for agronomists and farm owners. Every morning at 06:00 it re-checks each field and says what to do first, and why: pest and disease risk (risk, never a diagnosis, never pesticide products or doses), frost, irrigation, work windows. Once a year it plans five seasons (2026–2030) of crop rotation, and the headline is the decision for next season. The agronomist does the field work; the owner sees each decision with its numbers and answers in one tap. A public page, `/explore`, shows how the climate of any point on Earth has shifted since 1981, without an account.

**The shift, with numbers.** For Pivot 14 in Finney County, Kansas, NASA POWER weather from 1981 to 2026 shows a growing season 1.3°F warmer than in 1981–2000, a first autumn frost 8 days later (Oct 21 to Oct 29) and 207 more growing degree days (°F·d). Rainfall: 14.76 in to 14.28 in, "no clear trend", and the app says so. Trends use Mann–Kendall and Theil–Sen tests.

**The plan.** For North quarter, a dryland field, five options were run over five seasons, each on 150 weather runs and 10 price scenarios. The recommended rotation (wheat, sorghum, sunflower, fallow) earns $32 per acre a year more than today's. Sensitivity: "The same option is best in every set of weather years; the order of the others changes." This is a sensitivity analysis, not a forecast. At farm level, if the weather of 2022 repeats, the recommended plan puts $4,643 less at risk than the current plan (5 of 7 fields counted).

**The proof, and the limits.** The "How far can you trust this" page runs the same model over past seasons and compares it with USDA NASS yields and with MODIS greenness: r = 0.71 against official yields and r = 0.82 against satellite greenness, over 10 years. It lists the years the model missed (2012, 2014, 2022, 2023) and why: heat, frost and harvest losses are not modelled yet. On irrigated fields the model shows the same yield every year, so it cannot be checked against yields, and the page says so. Official comparison uses Kansas state-level yields because county series are sparse; crop prices are typed in from published reports; flowering-heat thresholds are cited but not yet reviewed.

**Benefits.** Decisions come with the evidence, the confidence and the limits. Every number the AI assistant says is checked against the models ("5 numbers checked against the models" in our test chat). Owners and agronomists share one simple view.

**What we hope to achieve.** Make "adapting a farm to a shifted climate" a routine, checkable decision rather than a guess. Next: heat stress in the model, a GPM IMERG rainfall cross-check, more regions, and a public host. Ukraine already works in estimate mode.

**Tools and languages.** TypeScript throughout: Next.js and React (web), NestJS (API), PostgreSQL with PostGIS and Prisma, RabbitMQ, MapLibre GL, Playwright and Cypress for tests, Node.js. Models are our own implementations of FAO-56 and FAO-33 water balance, SCS-CN runoff, ICBM soil carbon and a Monte Carlo simulator. The Google Gemini API writes wording only. UI languages: English and Ukrainian.

**About the demo.** The people shown in the app (company "Prairie Field Co.", Owner Olena Kovalenko, Agronomist Marko Shevchenko) are a fictional persona. The fields and the data are real. No photos of people are used.

---

## Use of Super Intelligence

- **AI coding assistant.** Code, tests and documentation were written and reviewed with an AI coding assistant (Claude Code) under the team's direction. The team set the scope, reviewed the results and owns them.
- **Google Gemini API inside the product.** It writes the wording of recommendations and assistant answers from model outputs, through function calling over our tools. Every number in an answer is checked against tool results; the interface shows how many were checked. Gemini never produces the numbers.
- **Demo video narration.** The narration is spoken by two AI-generated voices (Google Gemini TTS). The screen recording shows the real application.
- **No AI-generated images or video, and no AI-generated data.** The slides use real screenshots of the app and an HTML diagram. No NASA logos or design elements are used.
- **Where this is acknowledged:** the README ("AI use" note at the top), the video file metadata (comment and description) and its end card ("Narration: AI-generated voices"), the last slide and footer of the deck, and this page.

---

## NASA Data

| Dataset | What exactly is used | Period | How it changes a result |
| --- | --- | --- | --- |
| **NASA POWER** (daily weather). Credit: NASA Langley Research Center POWER Project, funded through the NASA Earth Science Directorate Applied Science Program | Daily temperature and precipitation at the field's grid cell (about 55 km grid) | From 1981 to today (here to 2026-11-12) | The "Field shift" block (warmer season, later first frost, degree days, rainfall), the 150 weather runs behind every rotation, the degree-day risk of pests, and the water balance. The deck's 45-year claim comes from this. |
| **MODIS NDVI** (LP DAAC, MOD13Q1) | Vegetation index per field | From 2000 | Crop-history estimates, and the independent greenness check on the "How far can you trust this" page (r = 0.82 over 10 years for North quarter). |
| **GPM IMERG** monthly precipitation (GES DISC, GPM_3IMERGM v07). DOI: 10.5067/GPM/IMERG/3B-MONTH/07 (`https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07`) | Intended as an independent rainfall check of POWER | From 2001 | **Not used in any result yet.** It is written but not verified live: the app shows "The GPM IMERG check is not available right now". Listed under "next". |

SMAP is **not** used. NASA data are used with acknowledgement; this project does not imply NASA endorsement. `THIRD-PARTY-NOTICES.md` records the official product names, the DOI above and the Earthdata access terms; it records no other NASA URL, so add the official dataset pages (POWER, MOD13Q1) here only if you want them, taking them from the providers' own pages.

---

## Space Agency Partner Data and Other References

All terms below are as recorded in `THIRD-PARTY-NOTICES.md` (working summary, last reviewed 2026-11-15). Repository: `https://github.com/nekojidev/Terrasight`.

**ESA / Copernicus (Space Agency Partner for 2026)**

- **Copernicus Sentinel-2** (via the Copernicus Data Space Ecosystem): field imagery, NDVI and management zones outside the US and as a complement. Free, full and open under the Copernicus data policy (Regulation (EU) 1159/2013). "Contains modified Copernicus Sentinel data".
- **Copernicus DEM GLO-30**: field slope and elevation. Free with attribution: "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".
- **EOX Sentinel-2 cloudless 2016** (basemap, `s2maps.eu`): satellite background for outlining fields. CC BY 4.0. Shown on every map: "Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)".
- **ECMWF SEAS5 via Open-Meteo** (Copernicus Climate Change Service): seasonal outlook. CC BY 4.0.

**USDA (US government works, public domain)**

- **NASS Cropland Data Layer (CDL)**: crop per year, US, 2008 onward.
- **NRCS SSURGO**: US soil.
- **NASS Quick Stats**: county and state survey yields (prices are typed in from NASS / AMS reports, not fetched).

**Other data and services**

- **Open-Meteo** (`Open-Meteo.com`): 7 to 16 day forecast. CC BY 4.0; production uses the paid key. "Weather data by Open-Meteo.com".
- **NOAA National Weather Service**: US forecast fallback, public domain.
- **OpenET**: field water use. Open licence with attribution (CC BY-style).
- **ISRIC SoilGrids 2.0**: soil outside the US. CC BY 4.0.
- **FAO WaPOR v3**: actual evapotranspiration for Ukraine. CC BY 4.0. No FAO endorsement implied.
- **FAO** methods: FAO-56 (water balance) and FAO-33 (yield response, Ky), implemented by the team.
- **Esri / Impact Observatory 10 m annual land cover** (via Microsoft Planetary Computer): cropland map outside the US. CC BY 4.0. "Esri, Impact Observatory, and Microsoft".
- **Natural Earth**: county and admin-1 boundaries. Public domain.
- **State Statistics Service of Ukraine (Ukrstat)** via data.gov.ua: oblast-level yields for Ukraine.
- **OpenStreetMap Nominatim**: address search. Data © OpenStreetMap contributors (ODbL).
- **Google Gemini API** (service, not data): wording of recommendations and assistant answers; and Gemini TTS for the demo narration.

**Libraries and frameworks** (licences as recorded in `THIRD-PARTY-NOTICES.md`): Next.js and React (MIT), MapLibre GL (BSD-3-Clause), lucide-react (ISC), NestJS (MIT), Prisma (Apache-2.0), `@google/genai` (Apache-2.0), `@sentry/node` (MIT). The production dependency tree has no GPL or AGPL packages. Fonts: Onest and JetBrains Mono, as served by the app. Project licence: not decided yet.

---

## Owner checklist before submitting (not for the form)

- [ ] `tools/demo-deck/team.json` is filled (team "Vibe-Kitties", one member, event "Kyiv"). If you change it, run `pnpm demo:deck` (and `pnpm demo:video` for the end card) with the app running.
- [ ] Push to GitHub (`git push`), so `demo/terrasight-30s.mp4`, `demo/terrasight-deck.pdf` and `docs/submission.md` are reachable. The repository must be public.
- [ ] Open both demo links, the repository and the public page (if any) in a **private browser window** without logging in. Confirm the video plays and is 30 seconds or less, and the PDF has 7 pages.
- [ ] Paste the texts above into the Project page fields, in this order.
- [ ] Tick the two boxes (the AI disclosure and the open-data / rules acknowledgements, as the form words them).
- [ ] Press **Submit for Judging** before 23:59 local time today.
- [ ] Optional: if a new website hosts the project, request a FortiGuard web-filter categorisation for it, so school and company networks do not block the judges.
