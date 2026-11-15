// Voice: one audio file per line, cached by hash(text + provider + voice + rate).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { OUT, elevenLabsEnv, geminiEnv } from "./env.mjs";

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

/**
 * Optional style instruction for Gemini TTS (part of the cache key). Empty by default: the model tends to read a long
 * instruction aloud, so the tone comes from the choice of voice instead.
 */
const GEMINI_STYLE = process.env.DEMO_GEMINI_STYLE || "";

/** One line through Gemini TTS: returns the audio (WAV or raw PCM with its rate). Retries a few times on 429 / 5xx. */
async function geminiSpeak(g, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${g.model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: GEMINI_STYLE ? `${GEMINI_STYLE} ${text}` : text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: g.voice } } },
    },
  };
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": g.key, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = await r.json();
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (part) {
        const data = Buffer.from(part.inlineData.data, "base64");
        // The API answers either with a WAV file or with raw 16-bit PCM ("audio/L16;rate=24000").
        const isWav = data.subarray(0, 4).toString("latin1") === "RIFF";
        const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || "")?.[1] ?? 24000);
        return { data, isWav, rate };
      }
      last = "no audio in the response";
    } else {
      last = "HTTP " + r.status;
      if (r.status !== 429 && r.status < 500) break;
    }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error("Gemini TTS failed: " + last);
}

export async function synthesize(lines) {
  const dir = path.join(OUT, "audio");
  fs.mkdirSync(dir, { recursive: true });
  const el = elevenLabsEnv();
  const gm = geminiEnv();
  // DEMO_TTS forces a provider; otherwise ElevenLabs when its key exists, else Gemini, else the offline macOS voice.
  const forced = process.env.DEMO_TTS;
  let provider = "say";
  let voiceName = `${SAY_VOICE} (macOS say, rate ${SAY_RATE})`;
  let voiceId = SAY_VOICE;
  if (forced === "gemini" || (!forced && !el.key && gm.key)) {
    if (!gm.key) throw new Error("DEMO_TTS=gemini needs GEMINI_API_KEY");
    provider = "gemini";
    voiceId = `${gm.model}:${gm.voice}:${GEMINI_STYLE}`;
    voiceName = `${gm.voice} (Gemini TTS, ${gm.model})`;
  } else if (forced !== "say" && el.key) {
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
  const info = { provider, voice: voiceName, draft: provider === "say", files: {}, durations: {} };
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
      } else if (provider === "gemini") {
        const { data, isWav, rate } = await geminiSpeak(gm, l.text);
        const raw = wav.replace(/\.wav$/, isWav ? ".src.wav" : ".pcm");
        fs.writeFileSync(raw, data);
        const input = isWav ? ["-i", raw] : ["-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", raw];
        execFileSync(FFMPEG, ["-y", "-v", "error", ...input, "-ar", "48000", "-ac", "1", wav]);
        fs.rmSync(raw);
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
