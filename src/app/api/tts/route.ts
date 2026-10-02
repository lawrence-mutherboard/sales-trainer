import { z } from "zod";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/api/auth";
import { openai } from "@/lib/ai/openaiProvider";
import { ElevenSetupError, elevenLabsEnabled, pickElevenVoice, streamElevenLabsSpeech } from "@/lib/ai/elevenlabs";
import { pickAccent } from "@/lib/voice/accent";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  text: z.string().trim().min(1).max(600),
  // The prospect's full name. Picks a consistent voice (and gender) for the whole call.
  voiceSeed: z.string().trim().min(1).max(100),
  // How the prospect sounds. Unknown values are ignored.
  personality: z.string().max(30).optional(),
  mood: z.string().max(30).optional(),
});

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pickVoice(seed: string): string {
  const first = seed.split(/\s+/)[0]?.toLowerCase() ?? "";
  const feminine = config.personas.name_pools.feminine_first_names.some((n) => n.toLowerCase() === first);
  const pool = feminine ? config.ai.tts.voices.feminine : config.ai.tts.voices.masculine;
  return pool[hash(seed) % pool.length];
}

// Light per-user limit so a stuck page can't burn through the OpenAI budget. (In memory: per server instance.)
const hits = new Map<string, number[]>();
function tooMany(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 90;
}

// Turns the prospect's reply (or one line of it) into streaming speech with a natural neural voice.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (tooMany(auth.user.id)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { text, voiceSeed, personality, mood } = parsed.data;

  try {
    // ElevenLabs when TTS_BACKEND=elevenlabs and its key is set; otherwise OpenAI.
    if (process.env.TTS_BACKEND === "elevenlabs" && !process.env.ELEVENLABS_API_KEY) {
      console.warn("[tts] TTS_BACKEND=elevenlabs but ELEVENLABS_API_KEY is empty, so OpenAI is being used for the voice.");
    }
    if (elevenLabsEnabled()) {
      try {
        const first = voiceSeed.split(/\s+/)[0]?.toLowerCase() ?? "";
        const feminine = config.personas.name_pools.feminine_first_names.some((n) => n.toLowerCase() === first);
        const accent = pickAccent(voiceSeed, config.ai.tts.accent.uk_percent);
        const voiceId = await pickElevenVoice(voiceSeed, feminine, accent);
        const upstream = await streamElevenLabsSpeech({ text: speakable(text), voiceId, personality, mood });
        if (process.env.NODE_ENV !== "production") console.log(`[tts] ElevenLabs voice ${voiceId} (${accent}, ${feminine ? "feminine" : "masculine"}) mood=${mood ?? "-"}`);
        return new Response(upstream.body, {
          headers: { "Content-Type": "audio/pcm", "Cache-Control": "no-store", "X-TTS-Backend": "elevenlabs" },
        });
      } catch (err) {
        // A setup problem (for example a missing permission) fails every time, so use OpenAI for the whole call instead of
        // breaking it, and say clearly what to fix. Other errors (network, rate limits) are retried by the browser.
        if (!(err instanceof ElevenSetupError)) throw err;
        console.error(`[tts] ELEVENLABS NOT USED. ${err.message} Using the OpenAI voice instead.`);
      }
    }

    const tts = config.ai.tts;
    const speech = await openai().audio.speech.create({
      model: tts.model as "gpt-4o-mini-tts",
      voice: pickVoice(voiceSeed),
      input: speakable(text),
      instructions: buildInstructions(voiceSeed, personality, mood),
      speed: Math.min(4, Math.max(0.25, tts.speed * (mood ? (tts.mood_speed[mood] ?? 1) : 1))),
      response_format: "pcm", // raw 24 kHz 16-bit audio, so the browser can start playing while it is still being generated
    });
    return new Response(speech.body, {
      headers: { "Content-Type": "audio/pcm", "Cache-Control": "no-store", "X-TTS-Backend": "openai" },
    });
  } catch (err) {
    console.error("tts: failed", err);
    return NextResponse.json({ error: "Speech failed" }, { status: 502 });
  }
}

// Base voice direction + this prospect's personality + how they sound right now.
function buildInstructions(voiceSeed: string, personality?: string, mood?: string): string {
  const tts = config.ai.tts;
  // Each prospect has one accent for the whole call (roughly uk_percent % British, the rest American).
  const accent = pickAccent(voiceSeed, tts.accent.uk_percent);
  const parts = [tts.instructions, tts.accent[accent]];
  const style = personality ? tts.personality_style[personality] : undefined;
  if (style) parts.push(style);
  const moodText = tts.mood_in_instructions && mood ? tts.moods[mood] : undefined;
  if (moodText) parts.push(`Right now, this line should sound: ${moodText}.`);
  return parts.join(" ");
}

// Small clean-ups so numbers and names are said the way a person would say them. Only the audio is affected;
// the transcript keeps the original text.
function speakable(text: string): string {
  return text
    .replace(/£\s?(\d[\d,]*(?:\.\d+)?)\s?k\b/gi, "$1 thousand pounds")
    .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?k\b/gi, "$1 thousand dollars")
    .replace(/£\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 pounds")
    .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 dollars")
    .replace(/(\d)\s?%/g, "$1 percent")
    .replace(/monday\.com/gi, "monday dot com")
    .replace(/\s+/g, " ")
    .trim();
}
