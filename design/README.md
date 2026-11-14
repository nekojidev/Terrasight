# Terrasight — design handoff (v4 "Morning brief")

> **For Claude Code:** this folder is the design source for the frontend.
> - Read this file first.
> - Use `tokens.css` for every colour, size and motion value.
> - Use `i18n/*.json` for UI copy (UA and EN).
> - Match `screens/*.png` visually.
> - `canvas/*.dc.html` are the original mock-ups. Read them for exact spacing and inline styles, but don't copy their markup: they use a mock-up template syntax (`{{…}}`, `sc-if`, `sc-for`) and inline styles, not production React.
> - Product rules: `docs/01-product-definition.md` §9–§10. Behaviour: `docs/02-rfc.md` (sections referenced below).
> - Live canvas: https://claude.ai/artifact/U2sXZJueKJEd4ECsUz5dK5
> - All numbers and names in the mock-ups are demo data (Prairie Field Co., Kansas · Nebraska · Colorado), not model output.

## 1. Principles

1. **One focus per screen:** one hero item, one primary action. Details on demand.
2. **Numbers as the argument:** big mono numbers with weight bars ("124 days bare") instead of adjectives.
3. **Ink and signal:** everything is ink on warm paper. The signal lime marks only what to do first: "Start here", the active nav item, the plan chip.
4. **Evidence next to advice:** every item shows Why (top factors with weights), confidence, data tier and source stamps.
5. **Neutral:** no product names or doses anywhere. The "No product ads · open public data: NASA, USDA, ESA and others" stamp is part of the brief header.
6. **Thumb reach on phones:** primary actions sit at the bottom; confirmations use bottom sheets.

## 2. Screens

| # | Screen | Route (suggested) | Size | Purpose · primary action | RFC |
| --- | --- | --- | --- | --- | --- |
| 01 | Login | `/login` | 1440 | Sign in · **Sign in** | §14 |
| 02 | Onboarding | `/onboarding` | 1440 | Create the company in 2 steps (name, time zone, units, report language → invite the owner as Viewer, skippable) · **Next / Invite and continue** | §14.2 |
| 03 | EmptyHome | `/` (no fields) | 1440 | First run: 3 steps + greyed example card · **Add your first field**; secondary **Explore the demo company** | §14.2 |
| 04 | Main | `/` | 1440 | Morning brief. Header: mono date kicker, greeting, one-sentence day summary, Analyze fields. **Hero** = first Urgent item with 3 key numbers. "Next, this week" rows with an expandable Why. "All fine" chips. Right rail: today in numbers, weather by county + next frost, owner question. · **Accept and add to the report** | §10.2, §10.4, §10.5 |
| 05 | MainMobile | `/` (< 640 px) | 390 | Same brief on a phone; bottom tabs; **Accept opens a bottom sheet** showing what the owner will see + an optional note | §10.4 |
| 06 | MainMobileDark | — | 390 | Dark-theme reference, with the sheet open (P2) | decision 14 |
| 07 | Fields | `/fields` | 1440 | Region chips + schematic state map with one pin per county (count, coloured by the most urgent status); list grouped by county with today's weather · **Add a field** | §14.1 |
| 08 | Field | `/fields/:id` | 1440 | Tabs: Overview · Zones & yield · Rotation · Owner report. **Field brief** "The main thing on this field" (3 numbers) → risks, 7-day weather, 18-season strip; assistant panel on the right · **Compare rotations** | §9 (field brief) |
| 09 | Rec | `/fields/:id/recommendations/:rid` | 1440 | Recommendation detail: plan / urgency chip, Top factors with weights + source stamps, 3 reasoning steps, options, what we don't know, owner message draft, sources · **Accept and add to the report** | §9 (risk card template) |
| 10 | Rotation | `/fields/:id/rotation` | 1440 | Ink banner "Recommended / Your choice for 2026: <crop>" with the lime **Save to the 2026 plan**; assistant note; priority picker; 3 option cards (5-tile strips); why / what to check; cumulative margin 2026–2030 with **yearly points**; "If 2022 repeats"; all numbers table | §7.7, §8 |
| 11 | Zones | `/fields/:id/zones` | 1440 | Stable zones ↔ today's NDVI, yield range, work log, integrations ("Coming soon"). Static mock in the hackathon | FR-ZN-1, FR-YF-1 |
| 12 | Scout | `/scout/:taskId` | 390 | Full-width W-route map; **bottom sheet** with point counter (−/+ out of 20), Previous / Next, Add a photo; summary "Points checked: N / 5"; **Send** only after all 5 points; "Saved automatically" | §10.7 |
| 13 | AddField | `/fields/new` | 1440 | Step indicator, map with draw / upload, name, area, irrigated yes/no, "what we'll find" · **Add field** | D1 |
| 14 | Assistant | `/assistant` | 1440 | Conversation list; answer with tool-result card (table with source line), "N numbers checked against the models", suggestion chips, quick commands; Gemini disclaimer | §12 |
| 15 | Reports | `/reports` | 1440 | Owner report status: items with Done / Not yet / Question; question + **reply draft built from the item**; past reports; schedule | §12.6, §15 |
| 16 | Report | `/r/:token` | 390 | What the owner sees on a phone: items with one-tap Done / Not yet / Question | §15.1–15.2 |
| 17 | States | — | 1440 | Loading skeleton, source error with Retry, success with 8 s Undo, offline (P1), empty | §10.2, §10.4 |


## 3. Components (build these first)

| Component | Variants / states | Notes |
| --- | --- | --- |
| Button | `primary` (ink; dark theme: light), `signal` (lime, ink text — only "Save to the 2026 plan" on the ink banner), `outline`, `ghost`, `link` (underlined), `icon` (44 × 44) | Height 44 / 48 / 52 / 56; radius 12–16; states: hover, pressed, focus ring 2 px ink + 2 px offset, disabled |
| Chip | urgency (`urgent` / `week` / `ok`), `signal` ("Start here", plan), `source-stamp` (mono, muted bg) | Radius 999 |
| HeroItem | open / done (ink row with lime check, **8 s countdown bar**, Undo) | One per screen |
| QueueRow | collapsed / **Why expanded** / done (countdown + Undo) / snoozed | Accept and Snooze as icon buttons |
| BigNumber | mono value + label + weight bar | Up to 3 per hero / field brief |
| FactorRows | label + 64 px weight bar | "Why" lists; data from `keyNumbers[]` / drivers |
| SeasonStrip | 5 bars in crop colours (+ optional label "2022–26") | Terrasight signature; on every field mention |
| FieldThumb | satellite tile with crop shape (pivot circle / strip) | Sentinel-2 true colour in production |
| RailCard | mono uppercase title + content | Right rail of the brief |
| AnalysisPanel | per-field row: waiting / running / done / **No data** + Retry; progress bar; "what we check in November" | RFC §10.2 |
| BottomSheet | handle, title, content, primary + cancel | Phone confirmations, scouting counter |
| Nav | sidebar (active item: muted fill + lime inset bar), top bar (⌘K search, UA/EN, notifications), bottom tabs (phone) | |
| Skeleton, ErrorCard, Toast/DoneRow, EmptyState | as on the States board | |

## 4. Behaviour that must match the RFC

- **Accept / Snooze (RFC §10.4):**
  - the item collapses to a done row with **Undo and a visible 8 s countdown**;
  - it reaches the Owner report only when the countdown ends;
  - Snooze shows "Snoozed until tomorrow 06:00";
  - on a phone, Accept first opens the bottom sheet.
- **Urgency (RFC §10.5):**
  - Urgent = ≤ 7 days and irreversible, or ≤ 2 days;
  - the hero is the first Urgent item;
  - plans sit under "All fine" with a lime "Plan: … · by <date>" chip.
- **Field brief:** in November the three numbers come from history and the simulator: "3/5 seasons corn after corn if the plan stays", "2 years of corn in a row already", "+$123/ha with alfalfa". No degree-day dates.
- **Scouting (RFC §10.7):** the last button is **Finish the check**; Send appears only after all 5 points; the UI says "Saved automatically", never "works offline".
- **Owner reply draft (RFC §12.6):** built from the report item; the agronomist edits before sending.
- **Copy:**
  - UA and EN for everything;
  - dates "25.06" (UA) and "Jun 25" (EN);
  - units follow the workspace (ha °C mm / ac °F in);
  - "Owner report", never "farmer report";
  - "5 years / 2026–2030", never "10 years".

## 5. Accessibility

- Body text ≥ 15 px. All text passes WCAG AA on its background; lime is never used as a text colour.
- Tap targets ≥ 44 px. Visible focus. `aria-live` on the analysis panel, done rows and the scouting counter.
- Reduced motion turns animations off (see `tokens.css`).

## 6. Folder

```
design/
  README.md        this file
  tokens.css       colours (light + dark), type, spacing, radii, shadows, motion
  screens/*.png    17 screens, UA, at design width (1440 desktop, 390 phone)
  i18n/*.json      UI copy per screen: { "uk": {...}, "en": {...} }
  canvas/*.dc.html original mock-ups (reference only)
```
