import "server-only";
import { config } from "@/lib/config";
import type { Accent } from "@/lib/voice/accent";

// ElevenLabs text-to-speech for the prospect's voice. Used by /api/tts whenever
// ELEVENLABS_API_KEY is set. Audio is requested as raw 24 kHz 16-bit mono (pcm_24000), the same format the
// player expects, so the browser's streaming playback works unchanged.

const API = "https://api.elevenlabs.io";

/** The ElevenLabs account or settings need fixing by a person (permissions, no voices). Retrying will not help. */
export class ElevenSetupError extends Error {}

export function elevenLabsEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---- Choosing a voice ----------------------------------------------------------------------------------------
// Voice IDs listed in config/ai.json -> tts.elevenlabs.voices are used first. If a list is empty, the voices on your
// ElevenLabs account are searched for a matching gender and accent (so you can test before choosing favourites).

interface AccountVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

let voiceCache: { at: number; voices: AccountVoice[] } | null = null;

async function accountVoices(): Promise<AccountVoice[]> {
  if (voiceCache && Date.now() - voiceCache.at < 60 * 60 * 1000) return voiceCache.voices;
  const res = await fetch(`${API}/v2/voices?page_size=100`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ElevenSetupError(
      res.status === 401 && detail.includes("voices_read")
        ? "Your ElevenLabs API key is missing the voices_read permission. Enable it in the ElevenLabs dashboard (or paste voice IDs into config/ai.json -> tts.elevenlabs.voices)."
        : `ElevenLabs could not list your voices (HTTP ${res.status}). ${detail.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { voices?: AccountVoice[] };
  voiceCache = { at: Date.now(), voices: data.voices ?? [] };
  return voiceCache.voices;
}

export async function pickElevenVoice(seed: string, feminine: boolean, accent: Accent): Promise<string> {
  const gender = feminine ? "feminine" : "masculine";
  const configured = config.ai.tts.elevenlabs.voices[accent][gender];
  if (configured.length) return configured[hash(seed) % configured.length];

  const voices = await accountVoices();
  const wantGender = feminine ? "female" : "male";
  const accentOk = (v: AccountVoice) => {
    const a = (v.labels?.accent ?? "").toLowerCase();
    return accent === "uk" ? /brit|uk|english/.test(a) && !/americ/.test(a) : /americ|us\b/.test(a);
  };
  const matches = voices.filter((v) => (v.labels?.gender ?? "").toLowerCase() === wantGender && accentOk(v));
  // Fall back to any voice of the right gender rather than failing the call.
  const pool = matches.length ? matches : voices.filter((v) => (v.labels?.gender ?? "").toLowerCase() === wantGender);
  if (!pool.length) throw new ElevenSetupError("No ElevenLabs voices found for this gender. Add voice IDs to config/ai.json -> tts.elevenlabs.voices.");
  return pool[hash(seed) % pool.length].voice_id;
}

// ---- Voice settings ---------------------------------------------------------------------------------------------
// Mood and personality change HOW the voice delivers a line (steadier or more emotional, more or less animated).
// They never change which voice it is.

export function voiceSettings(personality: string | undefined, mood: string | undefined) {
  const cfg = config.ai.tts.elevenlabs;
  const base = cfg.voice_settings;
  const moodAdj = (mood && cfg.moods[mood]) || { stability: 0, style: 0 };
  const persAdj = (personality && cfg.personalities[personality]) || { stability: 0, style: 0 };
  const speedMood = mood ? (config.ai.tts.mood_speed[mood] ?? 1) : 1;
  return {
    stability: clamp(base.stability + moodAdj.stability + persAdj.stability, 0, 1),
    similarity_boost: base.similarity_boost,
    style: clamp(base.style + moodAdj.style + persAdj.style, 0, 1),
    use_speaker_boost: base.use_speaker_boost,
    // ElevenLabs only accepts speeds between 0.7 and 1.2.
    speed: clamp(config.ai.tts.speed * speedMood, 0.7, 1.2),
  };
}

/** Starts streaming speech. Returns the raw upstream response (its body is 24 kHz 16-bit mono PCM). */
export async function streamElevenLabsSpeech(args: {
  text: string;
  voiceId: string;
  personality?: string;
  mood?: string;
}): Promise<Response> {
  const cfg = config.ai.tts.elevenlabs;
  const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(args.voiceId)}/stream?output_format=pcm_24000`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: args.text,
      model_id: cfg.model_id,
      voice_settings: voiceSettings(args.personality, args.mood),
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}
