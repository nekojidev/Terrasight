// Voice: one audio file per line, cached by hash(text + provider + voice + rate).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { OUT, elevenLabsEnv } from "./env.mjs";

export const FFMPEG = "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = "/opt/homebrew/bin/ffprobe";
const UA = "terrasight-demo-video/1.0";
const SAY_VOICE = process.env.DEMO_SAY_VOICE || "Samantha";
const SAY_RATE = process.env.DEMO_SAY_RATE || "172";
const PREFERRED = ["Sarah", "Rachel", "Daniel", "George", "Bella", "Charlotte", "Matilda", "Alice"];

export function duration(file) {
  return parseFloat(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      encoding: "utf8",
    }),
  );
}

async function pickVoice(key) {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key, "User-Agent": UA },
  });
  if (!r.ok) throw new Error("ElevenLabs voices list failed: HTTP " + r.status);
  const { voices } = await r.json();
  for (const n of PREFERRED) {
    const v = voices.find((x) => x.name?.toLowerCase().startsWith(n.toLowerCase()));
    if (v) return { id: v.voice_id, name: v.name };
  }
  return { id: voices[0].voice_id, name: voices[0].name };
}

export async function synthesize(lines) {
  const dir = path.join(OUT, "audio");
  fs.mkdirSync(dir, { recursive: true });
  const el = elevenLabsEnv();
  let provider = "say";
  let voiceName = `${SAY_VOICE} (macOS say, rate ${SAY_RATE})`;
  let voiceId = SAY_VOICE;
  if (el.key) {
    provider = "elevenlabs";
    if (el.voice) {
      voiceId = el.voice;
      voiceName = "voice id from ELEVENLABS_VOICE_ID";
    } else {
      const v = await pickVoice(el.key);
      voiceId = v.id;
      voiceName = v.name;
    }
  }
  const info = { provider, voice: voiceName, draft: provider !== "elevenlabs", files: {}, durations: {} };
  for (const l of lines) {
    const hash = crypto
      .createHash("sha1")
      .update([l.text, provider, voiceId, SAY_RATE].join("|"))
      .digest("hex")
      .slice(0, 12);
    const wav = path.join(dir, `${l.id}-${hash}.wav`);
    if (!fs.existsSync(wav)) {
      if (provider === "say") {
        const aiff = wav.replace(/\.wav$/, ".aiff");
        execFileSync("say", ["-v", SAY_VOICE, "-r", SAY_RATE, "-o", aiff, l.text]);
        execFileSync(FFMPEG, ["-y", "-v", "error", "-i", aiff, "-ar", "48000", "-ac", "1", wav]);
        fs.rmSync(aiff);
      } else {
        const r = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: { "xi-api-key": el.key, "Content-Type": "application/json", "User-Agent": UA },
            body: JSON.stringify({
              text: l.text,
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.6, similarity_boost: 0.75 },
            }),
          },
        );
        if (!r.ok) throw new Error("ElevenLabs TTS failed: HTTP " + r.status);
        const mp3 = wav.replace(/\.wav$/, ".mp3");
        fs.writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
        execFileSync(FFMPEG, ["-y", "-v", "error", "-i", mp3, "-ar", "48000", "-ac", "1", wav]);
      }
    }
    // trim leading/trailing silence so durations are speech only
    const trimmed = wav.replace(/\.wav$/, ".t.wav");
    if (!fs.existsSync(trimmed))
      execFileSync(FFMPEG, [
        "-y",
        "-v",
        "error",
        "-i",
        wav,
        "-af",
        "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
        trimmed,
      ]);
    info.files[l.id] = trimmed;
    info.durations[l.id] = duration(trimmed);
  }
  return info;
}
