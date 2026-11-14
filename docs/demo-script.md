# Demo script (S-09.05, S-09.06)

Prairie Field Co. (demo template, `apps/api/scripts/seed-demo.mjs`): Pivot 12 and Pivot 14 near Garden City, Kansas
(irrigated), Chase 7 in Chase County, Nebraska and Logan dryland 5 in Logan County, Colorado (dryland). Each step names a
fallback. Measured on the development host (2026-11-14): brief API p50 7 ms / p95 17 ms; Analyze fields for the 4 demo
fields 1.2 s; an uncached rotation run 2.7–3.3 s. Known gap: first recommendations for a brand-new location take 2–3 min
because MODIS NDVI gathering takes about 2 minutes (budget 60 s); use the demo company on stage.

| # | EN — say / do | UA — сказати / зробити | Fallback |
| --- | --- | --- | --- |
| 1 | "Every morning at 06:00 Terrasight checks every field." Open **Explore the demo company**. | «Щоранку о 06:00 Terrasight перевіряє всі поля.» Відкрийте **Переглянути демо-компанію**. | Already signed in as the demo agronomist in a second tab. |
| 2 | The brief: **Start here** — barley yellow dwarf on Pivot 14, urgent before the first frost. Show the 3 numbers. | Бриф: **Почніть з цього** — жовта карликовість на Півоті 14, терміново до першого морозу. | If the forecast has no frost, the item shows the 7-day scouting window instead — say so. |
| 3 | **Details**: why (sown 5 September, before K-State's 10 September planting date), the citation, what we don't know. | **Деталі**: чому (посіяно 5 вересня, раніше дати K-State 10 вересня), джерело, чого не знаємо. | Screenshot of the recommendation page in the deck. |
| 4 | **Accept** → the 8-second Undo → let it go: "the owner gets it only after 8 seconds". | **Прийняти** → 8 секунд на Undo → «власник отримає це лише після 8 секунд». | — |
| 5 | **Why?** → the assistant answers; "N numbers checked against the models". Ask "What if we sow alfalfa?" | **Чому так?** → асистент відповідає; «N чисел звірено з моделями». «А якщо люцерна?» | No network / quota: "Assistant unavailable" — show a golden-question recording (`tools/golden/recordings`). |
| 6 | Pivot 12 → **Rotation**: 3 options over 2026–2030, the priority picker re-ranks instantly, **Save to the 2026 plan**. | Півот 12 → **Сівозміна**: 3 варіанти на 2026–2030, вибір пріоритету, **Зберегти в план на 2026**. | Cached runs make this instant; sliders re-run in ~3 s. |
| 7 | On a phone: **Start a check** → 5 points on a W → counts → **Send**; the item's confidence lifts. | На телефоні: **Почати огляд** → 5 точок буквою W → кількість → **Надіслати**. | Use the browser's device mode on the laptop. |
| 8 | **Reports** → the owner's question and the reply draft; open the report link on a phone and tap **Done**. | **Звіти** → питання власника й чернетка відповіді; посилання на телефоні → **Зроблено**. | — |

## Laptop fallback (S-09.06)

Prepare the laptop **the evening before, online**:

```bash
docker compose -f infra/docker-compose.yml up -d --build          # PostGIS, RabbitMQ, Redis, api, web
docker compose -f infra/docker-compose.yml exec api npm run boundaries:load
docker compose -f infra/docker-compose.yml exec api node scripts/seed-demo.mjs   # note the printed demo passwords
```

The database volume keeps the seeded company; `fixtures/` (committed, real responses) is in the image. **On stage, with
no network:** `docker compose -f infra/docker-compose.yml up -d`, open http://localhost:3000. Sources that fail fall back
to the recorded responses (labelled cached with their date), the forecast to its recording ("forecast from N h ago"),
the brief, cards, Owner report and rotation scenarios work, and the assistant shows "Assistant unavailable".

**When to switch:** if the demo host doesn't load within 10 seconds, or the venue network drops — switch the screen to
the laptop and continue from the same step. Rehearse the switch once.
