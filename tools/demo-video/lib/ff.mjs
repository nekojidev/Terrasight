// ffmpeg helpers: cut / speed-ramp takes into exact-length clips, join, mix audio.
import { execFileSync, spawnSync } from "node:child_process";
import { FFMPEG, FFPROBE } from "./tts.mjs";

export const run = (args, opts = {}) =>
  execFileSync(FFMPEG, ["-y", "-v", "error", ...args], { stdio: ["ignore", "inherit", "inherit"], ...opts });
export const probe = (file, entries) =>
  execFileSync(FFPROBE, ["-v", "error", ...entries, file], { encoding: "utf8" }).trim();

const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "30", "-an"];

// segs: [{from,to,ramp?,zoom?}] seconds in the take. Output is exactly `len` seconds.
// ramp = target seconds for a section that is sped up: eased (slow-fast-slow, up to 8x in the middle); if the section is
// too long for 8x, only its tail is kept. zoom = {from,to,cx,cy}: push-in on the segment (scale 1 = the full frame).
const PROFILE = [1, 2.2, 5, 5, 2.2, 1];
const f3 = (n) => Number(n).toFixed(3);
export function renderClip({ input, segs, len, out, phone }) {
  const parts = [];
  let total = 0;
  segs.forEach((s, i) => {
    let { from, to } = s;
    let pieces;
    if (s.ramp) {
      let span = to - from;
      // k: base speed so that the eased profile yields `ramp` seconds of output; peak (5k) capped at 8x
      const sumInv = PROFILE.reduce((a, v) => a + 1 / v, 0);
      let k = (span / PROFILE.length) * sumInv / s.ramp;
      if (5 * k > 8) {
        k = 8 / 5;
        const need = ((s.ramp * k) / sumInv) * PROFILE.length; // source span giving exactly `ramp` at that k
        from = to - need;
        span = need;
      }
      k = Math.max(k, 1 / 5);
      const d = span / PROFILE.length;
      pieces = PROFILE.map((v, j) => ({ a: from + j * d, b: from + (j + 1) * d, speed: v * k }));
    } else pieces = [{ a: from, b: to, speed: 1 }];
    const dur = pieces.reduce((acc, p) => acc + (p.b - p.a) / p.speed, 0);
    total += dur;
    const labels = pieces.map((p, j) => {
      parts.push(
        `[0:v]trim=start=${f3(p.a)}:end=${f3(p.b)},setpts=(PTS-STARTPTS)/${p.speed.toFixed(4)}[s${i}_${j}]`,
      );
      return `[s${i}_${j}]`;
    });
    let chain = labels.length > 1 ? `${labels.join("")}concat=n=${labels.length}:v=1:a=0` : null;
    const z = s.zoom;
    // supersampled push-in: the frame is first scaled to 2x, then zoomed and cropped on that grid (half-pixel steps), then
    // scaled back: no jitter from integer rounding, and the crop never pins to the frame edge
    const zoom = z
      ? `scale=3840:2160:flags=bicubic,scale=w='trunc(3840*(${z.from}+(${z.to}-${z.from})*min(1,t/${f3(dur)}))/2)*2':h=-2:eval=frame:flags=bicubic,crop=3840:2160:x='(iw-3840)*${Math.min(z.cx ?? 0.5, 0.94)}':y='(ih-2160)*${z.cy ?? 0.5}',scale=1920:1080:flags=lanczos,setsar=1`
      : null;
    if (chain) parts.push(`${chain}${zoom ? "," + zoom : ""}[s${i}]`);
    else parts.push(`${labels[0]}${zoom ? zoom : "null"}[s${i}]`);
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

/** Join clips with a wipe, and a lime bar riding the wipe edge (the one signature transition). Returns the seam times. */
export function xfadeChain(files, lens, ov, out, lime = "0xC8F169") {
  const inputs = files.flatMap((f) => ["-i", f]);
  let filter = "";
  let prev = "[0:v]";
  let acc = lens[0];
  const seams = [];
  for (let k = 1; k < files.length; k++) {
    const offset = acc - ov;
    seams.push(offset);
    const label = `[x${k}]`;
    filter += `${prev}[${k}:v]xfade=transition=wipeleft:duration=${ov}:offset=${offset.toFixed(3)}${label};`;
    prev = label;
    acc = offset + lens[k]; // clip k already includes its own overlap tail (except the last)
  }
  const bar = 150;
  let last = prev;
  seams.forEach((t, i) => {
    const o = i === seams.length - 1 ? "[v]" : `[o${i}]`;
    filter += `color=c=${lime}:s=${bar}x1080:r=30[bar${i}];${last}[bar${i}]overlay=shortest=1:x='W-(W+${bar})*(t-${t.toFixed(3)})/${ov}':y=0:eval=frame:enable='between(t,${t.toFixed(3)},${(t + ov).toFixed(3)})'${o};`;
    last = o;
  });
  if (!seams.length) filter += `${prev}null[v]`;
  filter = filter.replace(/;$/, "");
  run([...inputs, "-filter_complex", filter, "-map", "[v]", ...ENC, out]);
  return seams;
}

// Synthesised sound design (ffmpeg only): a UI click and a soft whoosh.
export function makeSfx(dir) {
  const click = `${dir}/click.wav`;
  const whoosh = `${dir}/whoosh.wav`;
  run(["-f", "lavfi", "-i", "aevalsrc='sin(2*PI*1900*t)*exp(-t*140)+0.4*sin(2*PI*950*t)*exp(-t*90)':d=0.08:s=48000", "-ac", "1", click]);
  run([
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=0.55:c=pink:r=48000:a=0.8",
    "-af",
    "highpass=f=500,lowpass=f=3800,afade=t=in:st=0:d=0.25,afade=t=out:st=0.25:d=0.3",
    "-ac",
    "1",
    whoosh,
  ]);
  const pad = `${dir}/pad.wav`;
  // a low pulse at 120 bpm (E1 + B1), the tempo of the edit
  run([
    "-f",
    "lavfi",
    "-i",
    "aevalsrc='0.35*sin(2*PI*41.2*t)*(0.55+0.45*pow(sin(PI*t*2),2))+0.2*sin(2*PI*82.4*t)*(0.5+0.5*pow(sin(PI*t*2),4))+0.1*sin(2*PI*123.5*t)*(0.7+0.3*sin(2*PI*0.5*t))':d=31:s=48000",
    "-ac",
    "1",
    pad,
  ]);
  return { click, whoosh, pad };
}

const lufs = (file) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = r.stderr.match(/I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/);
  return m ? { lufs: Number(m[1]), peak: Number(m[2]) } : null;
};

/** items: voice lines {file, at}; sfx: {file, at, db}. 10 ms fades on every clip edge; two-pass loudnorm to -16 LUFS. */
export function mixAudio({ items, sfx = [], pad = null, total, out }) {
  const build = (list, name) => {
    if (!list.length) return null;
    const inputs = list.flatMap((it) => ["-i", it.file]);
    const chains = list
      .map((it, i) => {
        const d = Math.max(0.05, parseFloat(probe(it.file, ["-show_entries", "format=duration", "-of", "csv=p=0"])));
        return `[${i}:a]aformat=channel_layouts=mono:sample_rates=48000,afade=t=in:st=0:d=0.01,afade=t=out:st=${(d - 0.01).toFixed(3)}:d=0.01,volume=${it.db ?? 0}dB,adelay=${Math.round(it.at * 1000)}:all=1,apad[a${i}]`;
      })
      .join(";");
    const mix = `${list.map((_, i) => `[a${i}]`).join("")}amix=inputs=${list.length}:normalize=0:duration=first,atrim=0:${total.toFixed(3)},aformat=channel_layouts=stereo:sample_rates=48000[m]`;
    const f = out.replace(/\.wav$/, `.${name}.wav`);
    run([...inputs, "-filter_complex", `${chains};${mix}`, "-map", "[m]", f]);
    return f;
  };
  const vf = build(items, "voice");
  const sf = build(sfx, "sfx");
  const levels = { voice: lufs(vf), sfx: sf ? lufs(sf) : null };
  const raw = out.replace(/\.wav$/, ".raw.wav");
  const ins = ["-i", vf, ...(sf ? ["-i", sf] : []), ...(pad ? ["-i", pad.file] : [])];
  const n = 1 + (sf ? 1 : 0) + (pad ? 1 : 0);
  const pi = n - 1;
  let fc = "";
  let labels = "[0:a]" + (sf ? "[1:a]" : "");
  if (pad) {
    // the pad: fades in, ducks under the voice, fades out under the last line
    fc += `[${pi}:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=${pad.db}dB,afade=t=in:st=0:d=1.2,afade=t=out:st=${(total - pad.fade).toFixed(2)}:d=${(pad.fade - 0.1).toFixed(2)},atrim=0:${total.toFixed(3)}[p0];[0:a]asplit=2[v0][v1];[p0][v1]sidechaincompress=threshold=0.015:ratio=9:attack=15:release=450:makeup=1[pd];`;
    labels = "[v0]" + (sf ? "[1:a]" : "") + "[pd]";
  }
  fc += `${labels}amix=inputs=${n}:normalize=0:duration=first[m]`;
  run([...ins, "-filter_complex", fc, "-map", "[m]", raw]);
  const p1 = spawnSync(
    FFMPEG,
    ["-hide_banner", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const j = JSON.parse(p1.stderr.slice(p1.stderr.lastIndexOf("{"), p1.stderr.lastIndexOf("}") + 1));
  const af = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  run(["-i", raw, "-af", af, "-ar", "48000", out]);
  return { ...j, levels };
}

function piecesOf(s) {
  let { from, to } = s;
  if (!s.ramp) return [{ a: from, b: to, speed: 1 }];
  let span = to - from;
  const sumInv = PROFILE.reduce((a, v) => a + 1 / v, 0);
  let k = ((span / PROFILE.length) * sumInv) / s.ramp;
  if (5 * k > 8) {
    k = 8 / 5;
    span = ((s.ramp * k) / sumInv) * PROFILE.length;
    from = to - span;
  }
  k = Math.max(k, 1 / 5);
  const d = span / PROFILE.length;
  return PROFILE.map((v, j) => ({ a: from + j * d, b: from + (j + 1) * d, speed: v * k }));
}

/** Map a time in the take to the time in the cut clip (segments, eased speed-ups). */
export function mapTime(segs, t) {
  let acc = 0;
  for (const s of segs)
    for (const p of piecesOf(s)) {
      if (t >= p.a && t <= p.b) return acc + (t - p.a) / p.speed;
      acc += (p.b - p.a) / p.speed;
    }
  return null;
}
