// pnpm demo:video  ->  demo/terrasight-30s.mp4 + demo/terrasight-30s.srt
// Flags: --rerecord-all (also re-record the once-only takes: live assistant call, owner approval)
//        --only=a,b (record only these shots)   --burn (burn captions into the video)   --no-record (reuse all takes)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, OUT, loadConfig } from "./lib/env.mjs";
import { synthesize, FFMPEG } from "./lib/tts.mjs";
import { launch, signIn, newTake } from "./lib/take.mjs";
import { SHOTS, renderPhoneBackdrop } from "./lib/shots.mjs";
import { renderClip, xfadeChain, mixAudio, probe, run, joinClips, makeSfx, mapTime } from "./lib/ff.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const only = args
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");

// ---- the story: premise -> answer -> how it feels -> why believe it -> close
// Scene length = voice + lead + tail (never shorter than `min`). `group` = act: the lime wipe goes between groups, straight
// cuts inside. Voices: narrator (Charon) and the assistant (Kore, the closing line). A line without `lead` is a J-cut:
// it starts JCUT s before its picture.
const NARRATOR = process.env.DEMO_VOICE_NARRATOR || "Charon";
const ASSISTANT = process.env.DEMO_VOICE_ASSISTANT || "Kore";
const TAIL = 0.3;
const JCUT = 0.15;
const OV = 0.25; // act wipe
const STORY = [
  {
    id: "open",
    group: 0,
    min: 5.6,
    lead: 0.3,
    line: "Terrasight is an AI assistant for farmers. Every morning, it says what to do, and why.",
    voice: NARRATOR,
    shots: [["today", 1]],
  },
  { id: "add", group: 1, min: 2.5, line: "Add your field.", voice: NARRATOR, shots: [["addField", 1]] },
  {
    id: "tiles",
    group: 1,
    min: 6.0,
    line: "It shows what has changed on the field, and what to plant for five seasons.",
    voice: NARRATOR,
    shots: [["tiles", 1]],
  },
  {
    id: "ask",
    group: 2,
    min: 7.6,
    lead: 0.9,
    line: "Ask it anything. Every number is checked against the models.",
    voice: NARRATOR,
    shots: [["askLive", 1]],
  },
  {
    id: "proof",
    group: 2,
    min: 4.5,
    lead: 0.5,
    line: "And it shows you where it was wrong.",
    voice: NARRATOR,
    shots: [["proof", 1]],
  },
  {
    id: "end",
    group: 3,
    min: 3.0,
    jcut: 0.3,
    tail: 0.05,
    line: "From NASA data to your next decision.",
    voice: ASSISTANT,
    shots: [["endCard", 1]],
  },
];
// Re-cuts of the once-only takes (the take itself is never re-recorded: it holds a real field creation / a live Gemini call)
const RECUT = {
  addField: (c) => {
    const m = c.marks;
    c.segs = [
      { from: m.uploaded, to: m.checked, ramp: 0.75, zoom: { from: 1.7, to: 1.35, cx: 0.386, cy: 0.86 } },
      { from: m.checked, to: m.checked + 1.0, zoom: { from: 1.3, to: 1.5, cx: 1, cy: 0.74 } },
      { from: c.clicks[1] - 0.8, to: c.clicks[2] + 0.2, ramp: 0.75, zoom: { from: 1.5, to: 1.75, cx: 1, cy: 0.74 } },
    ];
  },
  askLive: (c) => {
    // palette typing (already zoomed), then straight to the question bubble + finished answer + opened data card:
    // no wide field page, no loading skeleton, no empty assistant page
    const m = c.marks;
    c.segs = [
      { from: c.clicks[0] + 0.3, to: m.typed + 0.02, ramp: 1.3 },
      { from: m.answered - 0.1, to: m.answered - 0.1 + 6.28 },
    ];
  },
};
const DISCLOSURE =
  "Narration: AI-generated voices (Google Gemini TTS). Screen recording of the real application; no AI-generated imagery.";
const ONCE = new Set(["addField", "askLive", "ask2", "assistant", "owner"]);
const NEEDED = new Set(STORY.flatMap((s) => s.shots.map(([id]) => id)));
const fmt = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

const cfg = loadConfig();
fs.mkdirSync(path.join(OUT, "takes"), { recursive: true });
fs.mkdirSync(path.join(OUT, "clips"), { recursive: true });
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "demo"), { recursive: true });

// 1. voice first
const voice = await synthesize(STORY.filter((s) => s.line).map((s) => ({ id: s.id, text: s.line, voice: s.voice })));
console.log(`voice: ${voice.provider} / ${voice.voice}${voice.draft ? "  (DRAFT)" : ""}`);
let t = 0;
for (const s of STORY) {
  s.dur = s.line ? voice.durations[s.id] : 0;
  s.lead = s.lead ?? 0;
  s.at = s.line ? (s.lead ? s.lead : -(s.jcut ?? JCUT)) : 0; // offset of the voice from the scene start (negative: J-cut)
  s.len = Math.max(s.min, s.at + s.dur + (s.tail ?? TAIL));
  s.start = t;
  t += s.len;
}
const total = t;
console.log(STORY.map((s) => `${s.id} ${s.len.toFixed(2)}s (voice ${s.dur.toFixed(2)})`).join("\n"));
console.log(`total ${total.toFixed(2)} s`);
if (total < 29.0 || total > 29.9)
  throw new Error(`total ${total.toFixed(2)} s is outside 29.0-29.9 s: edit the lines or the scene minimums`);

// 2. record (one browser, one take at a time)
const shotLens = {};
STORY.forEach((s, si) => {
  const tailOv = si < STORY.length - 1 && STORY[si + 1].group !== s.group ? OV : 0;
  s.shots.forEach(([id, w], k) => {
    shotLens[id] = s.len * w + (k === s.shots.length - 1 ? tailOv : 0);
  });
});
const results = {};
const phoneGeo = { x: 1160, y: 90, w: 416, h: 900, backdrop: path.join(OUT, "backdrop-owner.png") };
const browser = await launch();
try {
  const states = {};
  const need = (r) => (states[r] ??= signIn(browser, cfg, r));
  for (const [id, fn] of Object.entries(SHOTS)) {
    if (!NEEDED.has(id)) continue;
    const cache = path.join(OUT, "takes", id + ".json");
    const len = shotLens[id];
    let useCache =
      flag("no-record") ||
      (only && !only.includes(id)) ||
      (ONCE.has(id) && !flag("rerecord-all") && fs.existsSync(cache));
    if (useCache && fs.existsSync(cache)) {
      const c = JSON.parse(fs.readFileSync(cache, "utf8"));
      const sum = c.segs.reduce((a, s) => a + (s.ramp ?? s.to - s.from), 0);
      if (sum + 0.05 < len) {
        if (ONCE.has(id))
          console.log(
            `note: cached ${id} take is ${sum.toFixed(2)} s, scene needs ${len.toFixed(2)} s: last frame is held`,
          );
        else useCache = false;
      }
      if (useCache) {
        RECUT[id]?.(c);
        results[id] = c;
        console.log("reuse take", id);
        continue;
      }
    }
    if (only && !only.includes(id)) continue;
    const role = id === "owner" ? "owner" : "agronomist";
    const stateFile = await need(role);
    const take = await newTake(browser, cfg, id, { role, phone: id === "owner", stateFile });
    console.log("record", id, len.toFixed(2) + "s");
    let r;
    try {
      r = await fn(take, cfg, len);
    } catch (e) {
      await take.finish().catch(() => {});
      if (e.code === "NO_WAITING_ITEMS" && fs.existsSync(cache)) {
        console.log("owner: nothing waiting any more; reusing the cached approval take");
        results[id] = JSON.parse(fs.readFileSync(cache, "utf8"));
        continue;
      }
      throw e;
    }
    const { file, marks } = await take.finish();
    const dest = path.join(OUT, "takes", id + ".webm");
    fs.copyFileSync(file, dest);
    results[id] = { file: dest, segs: r.segs, marks, facts: r.facts, clicks: r.clicks };
    fs.writeFileSync(cache, JSON.stringify(results[id], null, 1));
    console.log("  facts", JSON.stringify(r.facts ?? {}));
  }
  if (!fs.existsSync(phoneGeo.backdrop) || !flag("no-record")) {
    const g = await renderPhoneBackdrop(browser, cfg, await need("owner"), phoneGeo.backdrop);
    Object.assign(phoneGeo, g);
  }
} finally {
  await browser.close();
}

if (Object.keys(results).length < NEEDED.size) {
  // preview: cut the recorded shots and grab a contact sheet of frames
  fs.mkdirSync(path.join(OUT, "preview"), { recursive: true });
  for (const id of only ?? []) {
    const r = results[id];
    if (!r) continue;
    const out = path.join(OUT, "preview", id + ".mp4");
    renderClip({
      input: r.file,
      segs: r.segs,
      len: shotLens[id],
      out,
      phone: id === "owner" ? phoneGeo : undefined,
    });
    const n = 6;
    for (let i = 0; i < n; i++)
      run([
        "-ss",
        ((shotLens[id] * (i + 0.5)) / n).toFixed(2),
        "-i",
        out,
        "-frames:v",
        "1",
        path.join(OUT, "preview", `${id}-${i}.png`),
      ]);
  }
  console.log("partial run (--only): takes are in tools/demo-video/out/takes; no video assembled");
  process.exit(0);
}

// 3. cut: every shot becomes an exact-length clip (page loads, spinners and waits are dropped / sped up)
const sceneClips = [];
const sceneLens = [];
STORY.forEach((s, si) => {
  const parts = [];
  s.shots.forEach(([id]) => {
    const r = results[id];
    const out = path.join(OUT, "clips", id + ".mp4");
    const got = renderClip({
      input: r.file,
      segs: r.segs,
      len: shotLens[id],
      out,
      phone:
        id === "owner"
          ? {
              ...phoneGeo,
              crop:
                Number(
                  probe(r.file, [
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width",
                    "-of",
                    "csv=p=0",
                  ]),
                ) > 400,
            }
          : undefined,
    });
    if (got + 0.05 < shotLens[id])
      console.log(
        `warn: ${id} take gives ${got.toFixed(2)} s for ${shotLens[id].toFixed(2)} s (last frame held)`,
      );
    parts.push(out);
  });
  const scene = path.join(OUT, "clips", `scene-${s.id}.mp4`);
  if (parts.length > 1) joinClips(parts, scene);
  else fs.copyFileSync(parts[0], scene);
  sceneClips.push(scene);
  sceneLens.push(s.len + (si < STORY.length - 1 && STORY[si + 1].group !== s.group ? OV : 0));
});

// 4. scenes of one act are joined with straight cuts; acts are joined with the lime wipe
const groups = [...new Set(STORY.map((s) => s.group))];
const groupClips = [];
const groupLens = [];
for (const g of groups) {
  const idx = STORY.map((s, i) => (s.group === g ? i : -1)).filter((i) => i >= 0);
  const out = path.join(OUT, "clips", `act-${g}.mp4`);
  if (idx.length > 1) joinClips(idx.map((i) => sceneClips[i]), out);
  else fs.copyFileSync(sceneClips[idx[0]], out);
  groupClips.push(out);
  groupLens.push(idx.reduce((a, i) => a + sceneLens[i], 0));
}
const silent = path.join(OUT, "video-silent.mp4");
const seams = xfadeChain(groupClips, groupLens, OV, silent);

// 5. sound: voices (J-cuts), synthesised clicks and whooshes (>= 12 LU under the voice), -16 LUFS
const sfxFiles = makeSfx(path.join(OUT, "audio"));
const sfx = seams.map((t) => ({ file: sfxFiles.whoosh, at: Math.max(0.05, t - 0.05), db: -10 }));
STORY.forEach((s) =>
  s.shots.forEach(([id], k) => {
    const r = results[id];
    if (!r?.clicks?.length) return;
    const off = s.start + (k ? s.len * s.shots[0][1] : 0);
    for (const c of r.clicks) {
      const m = mapTime(r.segs, c);
      if (m != null && m < shotLens[id]) sfx.push({ file: sfxFiles.click, at: off + m, db: -12 });
    }
  }),
);
const mix = path.join(OUT, "voice-mix.wav");
const ask = STORY.find((x) => x.id === "ask");
sfx.push({ file: sfxFiles.whoosh, at: ask.start + 1.45, db: -14 });
const ln = mixAudio({
  items: STORY.filter((s) => s.line).map((s) => ({ file: voice.files[s.id], at: s.start + s.at })),
  sfx,
  pad: { file: sfxFiles.pad, db: -26, fade: 3.4 },
  total,
  out: mix,
});
console.log("loudnorm measured input", ln.input_i, "LUFS; voice-only", JSON.stringify(ln.levels));

// 6. captions that match the audio exactly
const spoken = STORY.filter((s) => s.line);
const srt = spoken
  .map((s, i) => `${i + 1}\n${fmt(s.start + s.at)} --> ${fmt(s.start + s.at + s.dur)}\n${s.line}\n`)
  .join("\n");
fs.writeFileSync(path.join(ROOT, "demo/terrasight-30s.srt"), srt);

const final = path.join(ROOT, "demo/terrasight-30s.mp4");
const vf = flag("burn")
  ? [
      "-vf",
      `subtitles=${path.join(ROOT, "demo/terrasight-30s.srt")}:force_style='FontName=Helvetica,FontSize=18,Outline=2'`,
    ]
  : [];
run([
  "-i",
  silent,
  "-i",
  mix,
  ...vf,
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-c:v",
  "libx264",
  "-profile:v",
  "high",
  "-preset",
  "slow",
  "-crf",
  "17",
  "-maxrate",
  "5M",
  "-bufsize",
  "10M",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-t",
  total.toFixed(3),
  "-metadata",
  `comment=${DISCLOSURE}`,
  "-metadata",
  `description=${DISCLOSURE}`,
  "-metadata",
  "title=Terrasight: NASA Space Apps 2026, Field Shift",
  "-movflags",
  "+faststart",
  final,
]);

// 6. frames to look at: one per scene, one mid-transition
fs.rmSync(path.join(OUT, "frames"), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
const grab = (name, at) =>
  run(["-ss", at.toFixed(3), "-i", final, "-frames:v", "1", path.join(OUT, "frames", name + ".png")]);
STORY.forEach((s) => {
  grab(`${s.id}-a`, s.start + s.len * 0.45);
  grab(`${s.id}-b`, s.start + s.len * 0.92);
});
seams.forEach((t, i) => grab(`wipe-${i}`, t + OV / 2));
for (let i = 0; i < 29; i++) grab(`sec-${String(i).padStart(2, "0")}`, i + 0.5);

// contact sheets (4 frames each, half size) for a quick visual review
const names = fs
  .readdirSync(path.join(OUT, "frames"))
  .filter((f) => f.endsWith(".png") && !f.startsWith("sheet"))
  .sort();
for (let i = 0; i < names.length; i += 4) {
  const g = names.slice(i, i + 4);
  if (g.length < 4) break;
  const ins = g.flatMap((f) => ["-i", path.join(OUT, "frames", f)]);
  run([
    ...ins,
    "-filter_complex",
    "[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[3]scale=960:540[d];[a][b][c][d]xstack=inputs=4:layout=0_0|960_0|0_540|960_540[v]",
    "-map",
    "[v]",
    "-frames:v",
    "1",
    path.join(OUT, "frames", `sheet-${i / 4}.png`),
  ]);
}

const info = probe(final, [
  "-show_entries",
  "stream=codec_name,width,height,r_frame_rate,duration",
  "-show_entries",
  "format=duration,size",
  "-of",
  "default=nw=1",
]);
console.log(info);
console.log("done:", final);
fs.writeFileSync(
  path.join(OUT, "report.json"),
  JSON.stringify(
    {
      voice,
      scenes: STORY.map(({ id, start, len, dur, line }) => ({ id, start, len, dur, line })),
      total,
      facts: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.facts])),
    },
    null,
    1,
  ),
);
void FFMPEG;
void execFileSync;
