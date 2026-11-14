# EP-07 Scouting

**Goal:** a pest item becomes a 5-point check on a phone, and the result comes back as evidence.
**RFC:** §10.7. **Tech Design:** §11. **Design:** 12 Scout, 09 Rec.

### S-07.01 Create a task with a W-route

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §10.7 | §11 | 09 Rec, 04 Main | S-04.06 |

As an agronomist, I want a scouting route generated from the field, so that I check representative spots.

**Acceptance criteria**

- **Start a check** on a pest or disease item creates a task owned by the agronomist, listed under This week until sent.
- 5 points on a W inside the polygon inset by `min(30 m, 10% of the shorter side of the oriented bounding rectangle)` (configurable per workspace), deterministic for a polygon; points outside the inset polygon move to the closest point inside (unit tests with a pivot circle, a strip and an L-shape).
- The task opens from the home card and the recommendation page.

### S-07.02 Scouting screen on a phone

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §10.7 | §11, §15.4 | 12 Scout | S-07.01, S-00.06 |

As an agronomist in the field, I want a map and a counter within thumb reach, so that I can scout with one hand.

**Acceptance criteria**

- Full-width route map with the current point in the signal colour; a BottomSheet with −/+ counter out of 20, Previous / Next, Add a photo.
- "Points checked: N / 5"; the last point's button is **Finish the check**; **Send** appears only after all 5 points have a count.
- The draft is kept in the browser and labelled "Saved automatically"; the UI never says "works offline".
- The counter has `aria-live`; targets ≥ 44 px.

### S-07.03 Photos

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §10.7 | §11 | 12 Scout | S-07.02 |

As an agronomist, I want to attach photos to a point, so that the owner and I can see what I saw.

**Acceptance criteria**

- Presigned S3 PUT for JPEG / PNG / HEIC up to 10 MB; the bucket is private; reads use short-lived signed URLs.
- Photos are stored per point and never sent to Gemini.

### S-07.04 Send and result

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §10.7 | §11 | 12 Scout, 09 Rec | S-07.02 |

As an agronomist, I want the result computed and attached to the item, so that the risk reflects what I found.

**Acceptance criteria**

- Send is idempotent (client id); the server rejects fewer than 5 points; result = Σ affected / 100 plants.
- The recommendation's Why shows "Scouted on <date>: N%"; the confidence cap is lifted.
- The level changes only through a verified `scoutAction` threshold; otherwise the result is evidence only.

### S-07.05 Outcome after scouting

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 2 | §15.3 | §5.1 | 09 Rec | S-07.04 |

As an agronomist, I want to record what scouting found, so that outcomes can tune the models later.

**Acceptance criteria**

- Confirmed / Not found / Not checked with an optional note or count; pre-filled from a verified action threshold if there is one.
- Stored with the input snapshot and model versions.
