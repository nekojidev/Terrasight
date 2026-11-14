# EP-09 Demo readiness (enabler)

**Goal:** the P0 path works on a public demo host, even if a source is down.
**RFC:** §5.4, §17. **Tech Design:** §13, §16, §17.

### S-09.01 Demo host

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §3 | §17 | — | S-00.02 |

As the team, I want the app on a public HTTPS host, so that judges can open it.

**Acceptance criteria**

- One EC2 instance, a private S3 bucket, an IAM role and DNS are set up by hand (no Terraform in the hackathon; later, L-18); docker compose runs web, api (`ROLE=all`), PostGIS, RabbitMQ, Redis and Caddy (TLS).
- Secrets come from SSM Parameter Store; a daily `pg_dump` goes to S3.
- Deploy by pulling tagged images and `docker compose up -d`; rollback to the previous tag in one command. Logs only (pino), no OpenTelemetry (later, L-19).

### S-09.02 Record fixtures for the demo fields

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §5.4 | §13 | — | S-02.03, S-03.01 |

As the team, I want real recorded responses for every demo field, so that the demo survives a source outage.

**Acceptance criteria**

- `tools/record-fixtures` records every source and the forecast for the demo fields (Kansas pivots, Chase County NE, Logan County CO) into `fixtures/`.
- Fixtures are real responses only, never synthetic; served only when a live call fails, labelled `cached` with their date.

### S-09.03 Demo template workspace (seed)

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 3 | §14.2 | §17 | 04 Main | S-09.02, S-02.01 |

As the team, I want a seeded template company, so that "Explore the demo company" has the full story.

**Acceptance criteria**

- Prairie Field Co. with the demo fields, their history, season records (Pivot 14 sowing date), a saved plan where needed, and an owner Viewer with one open question.
- After a 06:00-equivalent run the brief shows BYD/aphids on Pivot 14 as the hero, wheat streak mosaic in This week or Urgent by its deadline, and the rootworm planning item under All good.

### S-09.04 End-to-end test of the P0 path

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 5 | — | §16 | all P0 screens | EP-01 … EP-08 |

As the team, I want the P0 path tested end to end, so that we know the demo works before going on stage.

**Acceptance criteria**

- Cypress: sign up → onboarding → add field → history → Analyze fields → brief → Accept + Undo + Accept → assistant "why?" → rotation Save to the 2026 plan → scouting Send → Owner report answer via link.
- Runs against the demo host before the demo and on every merge to main.

### S-09.05 Performance check and demo script

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 2 | — | §16 | — | S-09.04 |

As the team, I want measured budgets and a rehearsed script, so that the demo is fast and predictable.

**Acceptance criteria**

- Measured on the demo host: first recommendations < 60 s for a new field; Analyze fields < 30 s for the demo company; scenario run < 5 s; brief API p95 < 300 ms.
- A written demo script (UA and EN) follows the P0 path and names a fallback for each step.

### S-09.06 Laptop fallback for the stage

| Priority | Points | RFC | Tech Design | Design | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0 | 2 | §5.4 | §17, §20 | — | S-09.02, S-09.03 |

As the team, I want the whole demo on a laptop, so that the demo survives a failed host or network on stage.

**Acceptance criteria**

- `docker compose` on the presenter's laptop starts the full stack with the demo seed and recorded fixtures, without network access.
- With no network: the brief, cards, Owner report and rotation scenarios work; cached data is labelled with its date; the assistant shows "Assistant unavailable".
- The demo script (S-09.05) names when to switch to the laptop; the switch is rehearsed once.
