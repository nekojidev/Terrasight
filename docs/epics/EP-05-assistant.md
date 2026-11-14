# EP-05 AI assistant

**Goal:** the agronomist asks "why?" and gets answers whose every number comes from our tools.
**RFC:** D9 (§12). **Tech Design:** §12. **Design:** 14 Assistant, 08 Field (panel).

### S-05.01 Tool registry and executor

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §12.3 | §12.1, §12.4 | — | S-03.03, S-04.02 |

As the system, I want read-only tools with server-side scope, so that the model can't see or change what it shouldn't.

**Acceptance criteria**

- Tools from RFC §12.3 have zod schemas in `assistant-core`; Gemini function declarations are generated from them.
- The executor takes workspace, role and field scope from the session; a field id outside the workspace returns "not found" (test).
- Field names become aliases `F<n>` in tool results and are restored in the UI; no coordinates, user, company or owner names are sent.
- Every number in a tool result is tagged with its unit and display precision.

### S-05.02 Gemini orchestration and streaming

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §12.2 | §12.1, §12.5 | 14 Assistant | S-05.01, S-00.05 |

As an agronomist, I want answers to stream with visible progress, so that I'm not waiting in silence.

**Acceptance criteria**

- `@google/genai` with the model from `GEMINI_MODEL`; system rules from RFC §12.5; up to 6 tool calls and 30 s per turn.
- Progress events ("Reading 2022 weather…") and checked sentences stream on `conversation.<id>.answer`.
- Gemini down or over quota shows "Assistant unavailable"; the brief and cards keep working.
- Per-user and per-workspace rate limits (Redis, in-process fallback).

### S-05.03 Number check

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §12.4 | §12.2 | 14 Assistant | S-05.01 |

As an agronomist, I want every number in an answer to match the models, so that I can repeat it to the owner.

**Acceptance criteria**

- Allowed values: tool numbers at exact and display precision, supported unit conversions, both date formats, numbers in the question, list numbering.
- Sentences are split with `Intl.Segmenter` (uk / en); digits, decimals, percentages, ranges, dates and number words 0–20 (EN, UA) are extracted.
- The first failing sentence and the rest are replaced by a plain tool-result card "Showing the data directly"; the message is flagged `fallback`.
- A fixture suite of ≥ 50 passing and failing sentences in both languages is green.
- The UI shows "N numbers checked against the models" under checked answers (14).

### S-05.04 Safety filter and refusals

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §12.5 | §12.3 | 14 Assistant | S-05.03 |

As the product, I want product names and doses blocked, so that Terrasight never gives crop-protection prescriptions.

**Acceptance criteria**

- Dose patterns (EN and UA units) and names from `data/safety/actives.txt` replace the sentence with "Choice of treatment and dose: follow the product label and local rules."
- Product, chemical-price and legal questions get refusal templates in EN / UA.
- "10 years" in a rotation context is rewritten to the 5-season wording and logged.

### S-05.05 Assistant page and field panel

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | §12 | §15.2 | 14 Assistant, 08 Field | S-05.02, S-00.06 |

As an agronomist, I want the assistant on its own page and next to a field, so that I can ask in context.

**Acceptance criteria**

- 14: conversation list, answers with tool-result cards (table with source line), suggestion chips, quick commands, Gemini disclaimer.
- The field panel (08) and the recommendation page (09) open the assistant with that field / item as context.
- "Summarise the day" uses `get_brief` and names the same "Start here" item as the brief.

### S-05.06 Retention and deletion

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §12.7 | §12.5 | 14 Assistant | S-05.02 |

As a user, I want conversations deleted after 90 days or when I ask, so that data isn't kept longer than needed.

**Acceptance criteria**

- `expires_at = created_at + 90 days`; a daily job deletes expired conversations with messages and tool calls.
- The user can delete a conversation at once; deletion cascades.
- Golden-question logs are stored separately and contain no customer data.

### S-05.07 Golden questions

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 8 | §12.7 | §12.5, §16 | — | S-05.03, S-05.04, S-09.02 |

As the team, I want a fixed question set, so that we know the assistant's quality before the demo.

**Acceptance criteria**

- `tools/golden/*.yaml`: ≥ 30 questions per language on the demo fields (why, what-if, compare, summary, product / dose bait, horizon bait).
- CI runs them against recorded tool results; a nightly job runs them against the live model.
- The report shows number-check pass rate, refusals and horizon wording; the demo needs ≥ 90% answers shown without fallback.
