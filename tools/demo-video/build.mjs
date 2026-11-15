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
import { renderClip, xfadeChain, mixAudio, probe, run, joinClips } from "./lib/ff.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const only = args
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");

// ---- the story: one voice line per scene; scene length = voice + lead + tail (never shorter than `min`)
const LEAD = 0.25;
const TAIL = 0.35;
const OV = 0.2; // cross-fade between scenes
const STORY = [
  {
    id: "hook",
    min: 5.0,
    lead: 0.1,
    line: "NASA weather data, turned into a decision you can act on tomorrow. With the proof attached.",
    shots: [["hook", 1]],
  },
  {
    id: "brief",
    min: 5.2,
    line: "Every morning it reads the data, and says what to do first, and why.",
    shots: [
      ["briefHome", 0.38],
      ["briefField", 0.62],
    ],
  },
  {
    id: "rotation",
    min: 5.2,
    line: "It tests every rotation across a hundred and fifty weather runs, and ten price scenarios.",
    shots: [["rotation", 1]],
  },
  {
    id: "proofA",
    min: 4.4,
    line: "Every number the assistant gives is checked against the models.",
    shots: [["assistant", 1]],
  },
  { id: "proofB", min: 3.4, line: "And the models are checked against past seasons.", shots: [["trust", 1]] },
  { id: "owner", min: 3.4, line: "The owner decides in one tap.", shots: [["owner", 1]] },
  { id: "end", min: 3.0, line: "From NASA data, to tomorrow’s decision.", shots: [["endCard", 1]] },
];
const ONCE = new Set(["assistant", "owner"]);
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
const voice = await synthesize(STORY.map((s) => ({ id: s.id, text: s.line })));
console.log(`voice: ${voice.provider} / ${voice.voice}${voice.draft ? "  (DRAFT)" : ""}`);
let t = 0;
for (const s of STORY) {
  s.dur = voice.durations[s.id];
  s.lead = s.lead ?? LEAD;
  s.len = Math.max(s.min, s.dur + s.lead + TAIL);
  s.start = t;
  t += s.len;
}
const total = t;
console.log(STORY.map((s) => `${s.id} ${s.len.toFixed(2)}s (voice ${s.dur.toFixed(2)})`).join("\n"));
console.log(`total ${total.toFixed(2)} s`);
if (total < 28.2 || total > 31.8)
  throw new Error(`total ${total.toFixed(2)} s is outside 28.2-31.8 s: edit the lines or the voice rate`);

// 2. record (one browser, one take at a time)
const shotLens = {};
STORY.forEach((s, si) => {
  const tailOv = si < STORY.length - 1 ? OV : 0;
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
    results[id] = { file: dest, segs: r.segs, marks, facts: r.facts };
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

if (Object.keys(results).length < Object.keys(SHOTS).length) {
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
  sceneLens.push(s.len + (si < STORY.length - 1 ? OV : 0));
});

// 4. join with short cross-fades, mix the voice, normalise to -16 LUFS
const silent = path.join(OUT, "video-silent.mp4");
xfadeChain(sceneClips, sceneLens, OV, silent);
const mix = path.join(OUT, "voice-mix.wav");
const ln = mixAudio({
  items: STORY.map((s) => ({ file: voice.files[s.id], at: s.start + s.lead })),
  total,
  out: mix,
});
console.log("loudnorm measured input", ln.input_i, "LUFS");

// 5. captions that match the audio exactly
const srt = STORY.map(
  (s, i) => `${i + 1}\n${fmt(s.start + s.lead)} --> ${fmt(s.start + s.lead + s.dur)}\n${s.line}\n`,
).join("\n");
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
  "-preset",
  "medium",
  "-crf",
  "19",
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
  grab(`${s.id}-a`, s.start + s.len * 0.62);
  grab(`${s.id}-b`, s.start + s.len * 0.92);
});
STORY.slice(1).forEach((s) => grab(`transition-${s.id}`, s.start + OV / 2));

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
