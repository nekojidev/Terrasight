# Demo video (30 s)

Records the real running app and assembles `demo/terrasight-30s.mp4` (1920x1080, 30 fps, H.264 + AAC) and
`demo/terrasight-30s.srt`. One command from the repo root:

```sh
pnpm demo:video
```

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
   28.2 to 31.8 s.
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
