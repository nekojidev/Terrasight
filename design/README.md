# Terrasight — design handoff (v5 foundation, "Morning brief")

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

## 3a. v5 foundation: tokens, components, states, motion

v5 adds a shared foundation; screens are redesigned on top of it. Nothing from v4 was removed (old motion tokens are aliases).

### Tokens added

| Token | Value | Use |
| --- | --- | --- |
| `--ts-dur-instant` / `fast` / `base` / `slow` | 100 / 160 / 240 / 420 ms | Motion scale (Tailwind: `duration-instant` … `duration-slow`) |
| `--ts-ease-standard` | `cubic-bezier(.2,.7,.2,1)` | Default; `--ts-ease` is an alias (`ease-ts`) |
| `--ts-ease-enter` / `exit` / `emphasis` | `(0,0,.2,1)` / `(.4,0,1,1)` / `(.2,.9,.3,1.2)` | Things entering, leaving, and small overshoot (`ease-enter`, `ease-exit`, `ease-emphasis`) |
| `--ts-stagger` | 60 ms | Delay step for siblings (`stagger` utility with `style={{ "--i": n }}`) |
| `--ts-line-control` | light `#8C8576`, dark `#7D766A` | Border of every control (inputs, selects, outline and icon buttons, segmented options) |
| `--ts-scrim` | light `rgba(25,23,20,.45)`, dark `rgba(0,0,0,.6)` | Backdrop of sheets and dialogs (`bg-scrim`) |
| `--ts-shadow-hero`, `--ts-shadow-sheet` | dark theme overrides, black-based | Depth that is visible on dark surfaces |
| `--ts-tabbar` | 64 px | Phone bottom tab bar height; add it to bottom offsets of fixed elements |
| `--ts-page`, `--ts-page-narrow` | 1120 px, 720 px | Page column widths (`PageContainer`) |
| `--ts-pad-card` | 20 px | Card padding (`Surface pad="md"`) |

**Line rule (WCAG 1.4.11).** A border that identifies a control must reach 3:1 against both `--ts-bg` and `--ts-surface`: use `--ts-line-control` (`border-line-control`). `--ts-line-strong` (about 1.4:1) is for decorative dividers only, never for a control's edge.

New type utilities: `text-caption` (13/18, the smallest size for readable labels), `kicker` (uppercase mono label in `ink-3`; `text-micro` stays the bare recipe).

### New and extended components (`@terrasight/ui`)

| Component | One-line usage |
| --- | --- |
| `Surface` | `<Surface tone="card\|inset\|hero" pad="none\|sm\|md\|lg" as="section">` — the one card recipe |
| `Kicker` | `<Kicker>Source</Kicker>` — uppercase mono label |
| `ProgressBar` | `<ProgressBar value={3} max={5} label="Fields analysed" tone="ok" />` — `role="progressbar"`, width animates |
| `StatusDot` | `<StatusDot tone="urgent" label="Urgent" />` — dot plus screen-reader text; pair with visible text when space allows |
| `PageContainer` | `<PageContainer width="wide\|narrow">` — centred column with page padding |
| `Tabs` | `<Tabs items value onChange label />` — ARIA tabs, arrow/Home/End keys, 44 px, scrolls sideways on phone |
| `Disclosure` | `<Disclosure summary="Why">…</Disclosure>` — `aria-expanded`, rotating chevron, height animates |
| `Menu` | `<Menu label="More actions" items={[{ id, label, icon?, danger?, onSelect }]} align="end" />` — "⋯" overflow menu |
| `Skeleton` | `variant="card\|rows\|map\|number\|text"`, `rows={n}`; shimmer under `motion-safe:` |
| `Toast` | `useToast().show(message, tone?, { action: { label, onClick } })`; errors persist, info closes after 6 s |
| `BottomSheet`, `ConfirmDialog` | Tab focus trap, `bg-scrim` + `animate-fade` backdrop; the dialog uses `animate-pop` |
| `Chip` | `onClick` (and `pressed`) makes it a 44 px button; non-interactive chips are unchanged |
| `DoneRow` | The countdown bar is a CSS animation (`animate-countdown`); a timer only ends the Undo window |

In `apps/web`: `lib/format.ts` and `useFormat()` (dates, numbers, money, units, plurals; never hand-build "$12k" or "12 ha"), `useActionToast().fail(error, what, retry?)`, `QueryState` props `skeletonVariant` and `what`.

### State rules

- Say what happened, what you still see, and give one action. Example: "Couldn't load weather. Showing the last check from 06:00. [Retry]".
- Never colour alone: status always has text (a label, an icon with a name, or `StatusDot`'s screen-reader label).
- Errors persist until dismissed; only confirmations and info disappear on their own (6 s).
- Data already on screen stays on screen when a background refresh fails.
- Loading uses a skeleton of the final shape (`Skeleton variant`), never a bare spinner on a page.

### Motion rules

| What | Duration | Easing |
| --- | --- | --- |
| Press, hover, colour changes | `instant` 100 ms | `standard` |
| Popovers, menus, dialogs, toasts (`animate-pop`) | `fast` 160 ms | `emphasis` |
| Backdrop fade, disclosure height, chevron (`animate-fade`) | `base` 240 ms | `enter` / `standard` |
| Blocks rising in (`animate-rise`, optional `stagger`) | `slow` 420 ms | `standard` |
| Progress and weight bars | 300 ms (`duration-bar`) | `standard` |
| Skeleton sheen (`animate-shimmer`) | 1.4 s loop | linear |
| Just-changed row (`animate-flash`) | 900 ms once | `standard` |
| Undo countdown (`animate-countdown`) | `--ts-undo` (8 s) | linear |

Only state changes animate; nothing moves for decoration. Looping animations (spinner, shimmer, pulse) use `motion-safe:`. Under `prefers-reduced-motion: reduce`, `tokens.css` sets animation and transition duration to 0.01 ms, one iteration, and `scroll-behavior: auto`, so end states are kept and nothing flashes.

## 3b. v6: reading rules

Source: `docs/design-review-v6.md` §3. These are rules a developer can follow; the new components live in `packages/ui` (kit) and `apps/web/src/components` (they need translations). Copy is in `design/i18n/21-System.json` (namespace `System`).

### The eight decisions as rules

1. **Decision first, evidence one click away.** The first viewport holds one main thought and one action. Proof (checks, sources, numbers) goes into `<Evidence>`; link to it with `#evidence`.
2. **One trust line.** Trust is always the same line, `<TrustLine>`: reliability, data level, sources, date. Never invent a second pattern (badges, bars, percentages).
3. **One colour, one meaning** (table below). Risk colours are never used for reliability or for decoration.
4. **At most three key numbers per card**, each with its unit and what it means ("+0.8 t/ha vs. your rotation"). More numbers go behind the evidence.
5. **One visible notice per screen** (`<NoticeStack>`); the rest fold into "N more notes". Caveat lists use the same rule.
6. **Units by the field's country, money included** (`useFormat({ country })`: `fmt.area`, `fmt.yield`, `fmt.moneyPerArea`). US fields are imperial; never hand-build "$12k" or "12 ha".
7. **One date rule.** `fmt.date(d, "short")` = "12 Nov"; `"long"` = "12 November 2026" (day first in English too). Words only for yesterday, today, tomorrow: `fmt.dateRel(d)`. Never "3 days ago", never ISO dates in the UI.
8. **States have one shape**: what happened · what you still see · one action (`EmptyState`, `ErrorCard`, `Skeleton`, `QueryState`).

### Colour meaning

| Token / look | Means | Chip `tone` | `StatusDot` tone |
| --- | --- | --- | --- |
| `urgent` (red) | Act today | `urgent` | `urgent` |
| `week` (amber) | Act this week | `week` | `week` |
| `ok` (green) | Fine, nothing to do | `ok` | `ok` |
| `info` (blue) | Neutral information | `info` | `info` |
| dashed outline, no fill, ink-2 text | Estimate: not measured, modelled or global | `estimate` | (use `muted`) |
| `signal` (lime) | Fill only, e.g. the primary mark; never text colour, never a status | `signal` | none |

Reliability is not a risk: `TrustLine` draws it as ink text with a shield icon (`ShieldCheck` high, `Shield` medium, `ShieldAlert` low). No new colour tokens were needed for v6.

### New and extended components

| Component | Usage |
| --- | --- |
| `TrustLine` (web) | `<TrustLine reliability="high" dataLevel="A" sources={["NASA POWER","USDA CDL"]} lastDate="2026-11-12" estimate href="#evidence" />`. Data levels are named Full data / Basic data / Estimate (UK Повні дані / Базові дані / Оцінка). Two sources, then "+N". `compact` keeps only reliability, level and the estimate mark. `href` or `onClick` makes the line a 44 px link or button. |
| `Evidence` (web) | `<Evidence summary="3 checks · 2 sources · numbers verified" count={3} id="evidence">…</Evidence>`: title "Evidence", the summary stays visible while closed, opens by URL hash `#<id>`, remembers nothing. |
| `NoticeStack` (web) | `<NoticeStack notices={[{ id, tone: "info\|week\|urgent", title, body?, action? }]} moreLabel? />`: first notice visible (order = priority), the rest under "N more notes". Urgent uses `role="alert"`. |
| `SuggestionChips` (web) | `<SuggestionChips questions={[{ id, text }]} onAsk={(q) => …} />`: 2–3 questions in the farmer's words; the caller fills the composer or navigates. |
| `InsightRow` (web) | `<InsightRow icon={<Sprout />} title value="+0.2 t/ha" note href linkLabel />`: a once-a-season insight as one row; the whole row is the link, the value is mono. |
| `Disclosure` (ui) | New: `summaryNote` (quiet text while closed), `open` + `onOpenChange` (controlled), `id` (region id). |
| `EmptyState`, `ErrorCard` (ui) | New optional slots: `what` (what happened / what is empty; wins over `text` / `body`), `still` (what you still see). `EmptyState` without `actionLabel` / `onAction` has no button. `QueryState` passes `still` through. |
| `Chip tone="estimate"` (ui) | Dashed outline for estimates. |
| `useFormat` (web) | New: `moneyPerArea(amountPerHa, currency)`, `count(n, forms)` (plurals), `dateRel(d, { now?, style?, timeZone? })`; `date` styles `short` / `long`. |

`CaveatNotes` keeps its props and now renders through `NoticeStack`.

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
- Reduced motion collapses animations to their end state (see `tokens.css` and §3a).
- Control borders use `--ts-line-control` (3:1, WCAG 1.4.11); status is never colour alone; smallest readable label is `text-caption` (13 px).

## 6. Folder

```
design/
  README.md        this file
  tokens.css       colours (light + dark), type, spacing, radii, shadows, layout, motion
  screens/*.png    17 screens, UA, at design width (1440 desktop, 390 phone)
  i18n/*.json      UI copy per screen: { "uk": {...}, "en": {...} }
  canvas/*.dc.html original mock-ups (reference only)
```
