# EP-08 Owner report

**Goal:** what the agronomist accepts reaches the owner in plain words; the owner can answer in one tap.
**RFC:** D12 (§15), §12.6, §14.1. **Tech Design:** §5.1, §10.3, §14. **Design:** 15 Reports, 16 Report, 08 Field (Owner report tab).

### S-08.01 Report items from commits

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §15.1 | §10.3 | 15 Reports | S-04.04 |

As an agronomist, I want accepted items to appear in the Owner report, so that sharing takes no extra step.

**Acceptance criteria**

- The commit consumer writes a `report_items` snapshot (UA and EN text, note) after the 8 s Undo window.
- Items never change by themselves; when the recommendation changes, the agronomist sees "changed since accepted" and can **Republish**.
- Items are grouped by field and urgency; replay results can never be committed (guard).

### S-08.02 Reports page

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §15 | §14, §15.2 | 15 Reports | S-08.01, S-00.06 |

As an agronomist, I want to see what the owner has and how they answered, so that I can follow up.

**Acceptance criteria**

- 15: report items with Done / Not yet / Question status, open questions, past reports.
- The field page's Owner report tab shows that field's items.

### S-08.03 Owner view and report link

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §14.1, §15.1 | §14.1 | 16 Report | S-08.01 |

As the company owner, I want a simple report on my phone, so that I know what to do and why.

**Acceptance criteria**

- Viewers see the report in the app; `/r/:token` shows the same for a report link (token hashed, revocable, optional expiry, rate-limited).
- 16: mobile-first, report language of the workspace, plain-word items with action, deadline, one-line reason and "Scout to confirm" where relevant.
- No app chrome on `/r/:token`; no other data is reachable through the link.

### S-08.04 One-tap answers

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §15.2 | §5.1, §14 | 16 Report, 15 Reports | S-08.03 |

As the company owner, I want to answer each item in one tap, so that my agronomist knows where things stand.

**Acceptance criteria**

- Done / Not yet / I have a question (+ optional text); nothing is forced and no reminders are sent.
- The latest answer is shown, earlier answers kept; answers through a link are recorded as "via report link".
- A question appears in the brief's right rail and on Reports.

### S-08.05 Reply draft from the item

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §12.6 | §12.4 | 15 Reports, 04 Main (rail) | S-08.04, S-05.03 |

As an agronomist, I want a reply draft ready, so that answering the owner takes a minute.

**Acceptance criteria**

- `POST /report-items/:id/reply-draft` builds a template from the item (what, why with top drivers and key numbers, deadline, next step); optional Gemini rephrasing under the number check.
- The owner's question text is never sent to Gemini (test on the outgoing request).
- The agronomist sees the question next to the draft, edits and sends; sent replies appear on the owner's report.

### S-08.06 Manage report links

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1 | 3 | §14.1 | §14.1 | 15 Reports | S-08.03 |

As an Admin, I want to create and revoke report links, so that staff without accounts can read the report.

**Acceptance criteria**

- Create a link with language and optional expiry; copy it; revoke it (immediately stops working).
- Only Owner and Admin can manage links; the audit log records create and revoke.
