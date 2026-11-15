// ffmpeg helpers: cut / speed-ramp takes into exact-length clips, join, mix audio.
import { execFileSync, spawnSync } from "node:child_process";
import { FFMPEG, FFPROBE } from "./tts.mjs";

export const run = (args, opts = {}) =>
  execFileSync(FFMPEG, ["-y", "-v", "error", ...args], { stdio: ["ignore", "inherit", "inherit"], ...opts });
export const probe = (file, entries) =>
  execFileSync(FFPROBE, ["-v", "error", ...entries, file], { encoding: "utf8" }).trim();

const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", "-an"];

// segs: [{from,to,ramp?}] seconds in the take. Output is exactly `len` seconds.
// ramp = target seconds for a section that is sped up (max 8x; if the section is longer, only its tail is kept).
export function renderClip({ input, segs, len, out, phone }) {
  const parts = [];
  let total = 0;
  segs.forEach((s, i) => {
    let { from, to } = s;
    let speed = 1;
    if (s.ramp) {
      speed = Math.max(1, (to - from) / s.ramp);
      if (speed > 8) {
        speed = 8;
        from = to - 8 * s.ramp;
      }
    }
    total += (to - from) / speed;
    parts.push(
      `[0:v]trim=start=${from.toFixed(3)}:end=${to.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)}[s${i}]`,
    );
  });
  const concat = `${segs.map((_, i) => `[s${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[c]`;
  let post;
  if (phone) {
    const r = 50;
    post = `[c]${phone.crop ? "crop=390:844:0:0," : ""}fps=30,scale=-2:${phone.h}:flags=lanczos,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(abs(W/2-X),W/2-${r})*gt(abs(H/2-Y),H/2-${r}),if(lte(hypot(abs(W/2-X)-(W/2-${r}),abs(H/2-Y)-(H/2-${r})),${r}),255,0),255)',tpad=stop_mode=clone:stop_duration=3[p];[1:v][p]overlay=x=${phone.x}:y=${phone.y}:shortest=1,format=yuv420p[v]`;
  } else {
    post = `[c]fps=30,scale=1920:1080:flags=lanczos,tpad=stop_mode=clone:stop_duration=3,format=yuv420p[v]`;
  }
  const args = ["-i", input];
  if (phone) args.push("-loop", "1", "-framerate", "30", "-i", phone.backdrop);
  run([
    ...args,
    "-filter_complex",
    `${parts.join(";")};${concat};${post}`,
    "-map",
    "[v]",
    "-t",
    len.toFixed(3),
    ...ENC,
    out,
  ]);
  return total;
}

export function joinClips(files, out) {
  const list = files.map((f) => `file '${f}'`).join("\n");
  spawnSync("sh", ["-c", `printf '%s\\n' "$LIST" > "${out}.txt"`], { env: { ...process.env, LIST: list } });
  run(["-f", "concat", "-safe", "0", "-i", `${out}.txt`, "-c", "copy", out]);
}

export function xfadeChain(files, lens, ov, out) {
  const inputs = files.flatMap((f) => ["-i", f]);
  let filter = "";
  let prev = "[0:v]";
  let acc = lens[0];
  for (let k = 1; k < files.length; k++) {
    const offset = acc - ov;
    const label = k === files.length - 1 ? "[v]" : `[x${k}]`;
    filter += `${prev}[${k}:v]xfade=transition=fadewhite:duration=${ov}:offset=${offset.toFixed(3)}${label};`;
    prev = label;
    acc = offset + lens[k]; // clip k already includes its own overlap tail (except the last)
  }
  filter = filter.replace(/;$/, "");
  run([...inputs, "-filter_complex", filter, "-map", "[v]", ...ENC, out]);
}

export function mixAudio({ items, total, out }) {
  const inputs = items.flatMap((it) => ["-i", it.file]);
  const delays = items.map((it, i) => `[${i}:a]adelay=${Math.round(it.at * 1000)},apad[a${i}]`).join(";");
  const mix = `${items.map((_, i) => `[a${i}]`).join("")}amix=inputs=${items.length}:normalize=0:duration=first,atrim=0:${total.toFixed(3)},aformat=channel_layouts=stereo:sample_rates=48000[m]`;
  const raw = out.replace(/\.wav$/, ".raw.wav");
  run([...inputs, "-filter_complex", `${delays};${mix}`, "-map", "[m]", raw]);
  // two-pass loudnorm to -16 LUFS
  const p1 = spawnSync(
    FFMPEG,
    ["-hide_banner", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const j = JSON.parse(p1.stderr.slice(p1.stderr.lastIndexOf("{"), p1.stderr.lastIndexOf("}") + 1));
  const af = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  run(["-i", raw, "-af", af, "-ar", "48000", out]);
  return j;
}
