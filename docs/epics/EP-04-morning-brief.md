# EP-04 Morning brief

**Goal:** the home page answers "what do I do first today?" and lets the agronomist accept or snooze in place.
**RFC:** §9, §10.4, §10.5. **Tech Design:** §10.2, §10.3, §15.4. **Design:** 04 Main, 05 MainMobile, 07 Fields, 08 Field, 09 Rec, 17 States.

### S-04.01 Urgency function

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §10.5 | §10.2 | 04 Main | S-00.07 |

As an agronomist, I want items grouped by clear rules, so that I can trust what is called Urgent.

**Acceptance criteria**

- `classifyUrgency` implements: Urgent = ≤ 7 days and irreversible, or ≤ 2 days; This week = any other ≤ 7 days and every open scouting task; All good = the rest; planning items move to This week 14 days before the deadline.
- Days count in the workspace time zone; table-driven tests cover 2/3, 6/7/8, 13/14/15 days and a DST change.
- Order inside a group: deadline, level, confidence.

### S-04.02 Brief API

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §10.5 | §10.2, §14 | 04 Main | S-04.01, S-03.03 |

As the web app, I want one call that returns the brief, so that the home page renders fast.

**Acceptance criteria**

- `GET /brief` returns: date kicker data, day summary counts, hero (first Urgent, else first This week), This week rows, All good chips with each field's 5-season strip, last run summary, rail data (today in numbers, weather by county with next frost, open owner question).
- One item per field with "+N" for the rest; snoozed, accepted and expired items are excluded.
- p95 < 300 ms for 100 fields.

### S-04.03 Brief page (desktop)

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §10.5 | §15.2–§15.4 | 04 Main | S-04.02, S-00.06 |

As an agronomist, I want the morning brief as designed, so that the first thing is obvious.

**Acceptance criteria**

- Matches 04: mono date kicker, greeting, one-sentence day summary, **Analyze fields**, hero with 3 BigNumbers and weight bars, "Start here" chip, "Next, this week" QueueRows with expandable Why (FactorRows), "All fine" chips with plan chips, right rail.
- Every card shows the confidence and data-tier line.
- The neutrality stamp reads "No product ads · open public data: NASA, USDA, ESA and others".
- Loading uses skeletons that keep the card shape; source errors use the ErrorCard (17).

### S-04.04 Accept / Snooze with 8 s Undo

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §10.4 | §10.3 | 04 Main, 17 States | S-04.03, S-00.04 |

As an agronomist, I want to accept or snooze in place with Undo, so that I can clear the brief quickly without mistakes.

**Acceptance criteria**

- Accept collapses the item to a done row "Added to the owner report"; Snooze to "Snoozed until tomorrow 06:00". Both done rows show **Undo and a visible 8 s countdown**.
- `POST /recommendations/:id/undo` works for accepted **and** snoozed items within 8 s; after that it returns 409.
- The server commits an accepted item to the Owner report only after 8 s (`commit.8s`); Undo within 8 s returns it to Open and nothing reaches the report (Testcontainers test for the commit / Undo race).
- The countdown uses the server's `undoUntil`; the done row has `aria-live`.
- Snoozed items reappear after the next 06:00 run if they still fire.

### S-04.05 Phone brief and confirmation sheet

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 3 | §10.4 | §15.4 | 05 MainMobile | S-04.04 |

As an agronomist in the field, I want the brief on my phone, so that I can act without a laptop.

**Acceptance criteria**

- Below 640 px: first item, This week rows, All good as one row, bottom tabs (Home · Fields · Assistant · Reports).
- Accept opens a BottomSheet showing exactly what the owner will see, with an optional note; **Add to the report** confirms and starts the 8 s Undo.

### S-04.06 Recommendation detail

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §9 (risk card template) | §10.1, §10.3 | 09 Rec | S-04.02 |

As an agronomist, I want the full reasoning behind an item, so that I can defend it to the owner.

**Acceptance criteria**

- Matches 09: urgency / plan chip, top factors with weights and source stamps, reasoning steps, options, what we don't know, model citation, sources, owner message draft.
- Actions: Accept, Snooze, Dismiss, Edit text (marked "edited by the agronomist"), Start a check (pest / disease only).
- Pest and disease items end with "Scout to confirm"; no product names or doses appear anywhere.

### S-04.07 Field page and field brief

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §9 (field brief) | §9.2 | 08 Field | S-02.05, S-06.03 |

As an agronomist, I want one sentence about each field, so that I know the main thing before details.

**Acceptance criteria**

- Tabs: Overview · Zones & yield · Rotation · Owner report.
- "The main thing on this field": one sentence, three numbers that need no degree days (e.g. 3/5 seasons corn after corn if the plan stays · 2 years of corn in a row · +$123/ha with alfalfa), one primary action **Compare rotations**.
- Below: risks, 7-day weather, the 18-season strip; the assistant panel on the right.

### S-04.08 Fields page

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 5 | §14.1 | §6.4, §15.2 | 07 Fields | S-02.02, S-04.02 |

As an agronomist, I want all fields by county with a map, so that I can work region by region.

**Acceptance criteria**

- County chips (All · each county) and a schematic map of the company's states with one pin per county showing the field count, coloured by the most urgent status; a chip or pin filters the list.
- The list is grouped by county with today's weather; each row shows the next step and deadline or the plan note.
- No map on the home page.
