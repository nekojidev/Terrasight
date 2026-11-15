# Demo video (30 s)

**Story (v3, "premise, answer, how it feels, why believe it, close")**: every field has a history and NASA recorded 45
years of it -> Terrasight reads it for you -> add your field -> it shows what changed / what to watch / what to plant for
five seasons -> ask it anything, every number is checked -> it shows where it was wrong -> close. Two AI voices (Gemini TTS):
the narrator (`Charon`) and the assistant (`Kore`, the closing line); set per line with `voice:` in `STORY` (`build.mjs`).
To change a line, edit `line` in `STORY` and rebuild: scene lengths follow the measured voice and the build fails outside
29.0-29.9 s. Straight cuts inside an act, a lime wipe between acts, eased speed ramps, J-cuts (a line starts 0.15 s before its
picture), synthesised clicks / whooshes / a low 120 bpm pulse (ducked under the voice, faded out under the last line), -16 LUFS.

Motion graphics fed with real data (`lib/graphics.mjs`, pages built from `design/tokens.css`, recorded like any take):
`openGraph` draws the first autumn frost of every year 1981-2025 for North quarter's NASA POWER grid cell (lat 38,
lon -100.625; the series is fetched once with the `power` adapter of `packages/sources` into `out/power-cell.json`, annual values
from `packages/climate` `seasonSeries`, Theil-Sen from `theilSen`) and asserts that baseline, recent, "9 days later" and
"clear trend" equal what the field page states; `sources` (the data sources converge into the assistant mark), `tiles` (three fast full-frame cuts of the field page and the rotation page, re-recorded on design v6; the
screenshots of the field page and the rotation page, the GPM line cropped out), `proof` (the app's own rings for the missed years
appear one by one). `lib/series.mjs` is the data step.

Once-only takes (never re-recorded unless `--rerecord-all`): `addField` (really added a field; the cut re-uses it through
`RECUT` in `build.mjs`), `ask1` (a live Gemini call; also re-cut), plus older `assistant`, `owner`, `ask2` (not in this cut).

Needs: the local stack running (web :3000, API :4000) and seeded with `apps/api/scripts/seed-presentation.mjs`;
ffmpeg and ffprobe in `/opt/homebrew/bin`; Playwright's Chromium (`playwright@1.63.0` uses `chromium-1243`;
otherwise `npx playwright install chromium`). Playwright is a dev dependency of this package only (`apps/e2e` stays on
Cypress).

## Configuration (nothing of this is committed or printed)

| What | Env var | Default |
| --- | --- | --- |
| App URL | `DEMO_BASE_URL` | `http://localhost:3000` |
| Seed output JSON (credentials, field ids) | `DEMO_SEED_FILE` | the scratchpad `presentation.json` of the seed run |
| Owner / Agronomist sign-in | `DEMO_OWNER_EMAIL`, `DEMO_OWNER_PASSWORD`, `DEMO_AGRONOMIST_EMAIL`, `DEMO_AGRONOMIST_PASSWORD` | from the seed file |
| Field for the field scenes | `DEMO_FIELD_ID` | `fields.north-quarter.id` of the seed file |
| ElevenLabs | `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID` | read from the repo `.env` (only these two keys) |
| Draft voice | `DEMO_SAY_VOICE` (`Samantha`), `DEMO_SAY_RATE` (`172`) | |

## How it works

1. **Voice first** (`lib/tts.mjs`). The lines live in `STORY` in `build.mjs`. One audio file per line, cached in
   `out/audio/` by a hash of text + provider + voice + rate, then trimmed of silence and measured with ffprobe.
   With `ELEVENLABS_API_KEY` present the provider is ElevenLabs (voice from `ELEVENLABS_VOICE_ID`, otherwise the first
   of Sarah, Rachel, Daniel, George, ... in the account's voice list). Without a key it falls back to macOS `say`
   and the report calls the result a DRAFT. Changing the text, provider or voice regenerates only what changed.
2. **Scene lengths** come from the voice: `max(min, voice + lead + tail)`. The build stops if the total is outside
   29.0 to 29.9 s.
3. **Takes** (`lib/shots.mjs`, `lib/take.mjs`): one Playwright context per shot, `recordVideo`, `deviceScaleFactor: 2`,
   `en-US`, cookie `ts_locale=en`, light theme, fixed clock (`page.clock.setFixedTime`, 2026-11-15 07:40 Chicago),
   one sign-in per role (storage state in `out/state/`). The shot waits for real content, then the camera starts.
   Every number in an overlay is read from the DOM during the take and asserted (for example 45 years from the
   page copy and the clock, `8 days later` from the headline, `150` / `10` from "Tested on ...", r values from the trust
   page); the count-up ends exactly on the DOM string.
4. **Motion** (`lib/motion.js`, injected with `addInitScript`): cursor on eased Bezier paths, click ripple, camera
   (CSS transform on `<body>`), kinetic type, count-up, pulse. Colours, fonts, durations and easings are read from the
   page's computed `design/tokens.css` custom properties; nothing is hard-coded. Scrollbars and dev overlays are hidden.
5. **Cut** (`lib/ff.mjs`): each shot returns the segments to keep (page loads, waits for the assistant are dropped or
   sped up, at most 8x). Each shot becomes an exact-length clip; the phone scene (390 px viewport) is composited on
   a backdrop rendered from the tokens; the end card is an HTML page recorded the same way. Scenes join with a 0.2 s
   fade through white.
6. **Audio**: lines placed at scene start + lead, mixed, two-pass `loudnorm` to -16 LUFS. No music bed.
7. **Captions**: `demo/terrasight-30s.srt` is built from the same timings as the audio. `--burn` burns them in.

Frames to review are written to `out/frames/` (one per scene, one per transition, plus `sheet-*.png` contact sheets).
`out/report.json` has the voice, scene timings and the DOM facts used.

## Flags

`pnpm demo:video -- --only=hook,trust` records only those shots (and writes quick previews in `out/preview/`);
`--no-record` reuses all takes; `--rerecord-all` also re-records the once-only takes; `--burn` burns captions.

## What is cached and what is not

- `out/audio/`: voice files (hash of text + provider + voice + rate).
- `out/takes/`: every take; ordinary shots are re-recorded on each run.
- **Once-only takes**: `assistant` (a real Gemini call) and `owner` (really approves a waiting decision in the local
  database). They are re-used from `out/takes/` unless `--rerecord-all`. The seed leaves only two waiting
  decisions, so the owner scene can be recorded at most twice per seed; if nothing is waiting any more the
  cached take is used.

## Switching the voice

Put `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`) in the repo `.env` and run `pnpm demo:video`: the audio is
regenerated, the scene lengths follow the new durations (shots are recorded again, except the once-only ones).
Without a key the draft uses `say`.

## Installing Playwright

This folder is deliberately NOT part of the pnpm workspace: Playwright is needed only here, and keeping it out of the
root lockfile means the product's install never depends on it. Install it once in this folder:

```sh
cd tools/demo-video && npm install
```

(npm goes through the same registry mirror as the rest of the repo, so it needs a valid token.)

## Voice providers

`DEMO_TTS` chooses the voice: `elevenlabs` (needs `ELEVENLABS_API_KEY`), `gemini` (uses the product's `GEMINI_API_KEY`;
voice `DEMO_GEMINI_VOICE`, default `Charon`; per-line voices in `STORY`; model `DEMO_GEMINI_TTS_MODEL`, default `gemini-3.8-flash-tts`) or `say`
(offline macOS voice, a draft). Without `DEMO_TTS`: ElevenLabs when its key exists, else Gemini, else `say`.
Audio is cached per line by text, provider and voice; scene lengths follow the measured line durations.

Design v6 re-record: `addField` (archived afterwards through the API), `askLive` (one live Gemini call: the Ask field in the top bar -> palette -> assistant composer -> Send -> answer -> "Show the numbers") and all other screens were re-recorded on the redesigned interface; `RECUT` re-cuts `addField`.
