import { z } from "zod";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/api/auth";
import { ElevenSetupError, elevenLabsEnabled, pickElevenVoice, streamElevenLabsSpeech } from "@/lib/ai/elevenlabs";
import { pickAccent } from "@/lib/voice/accent";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  text: z.string().trim().min(1).max(600),
  // The prospect's full name. Picks a consistent voice (gender and accent) for the whole call.
  voiceSeed: z.string().trim().min(1).max(100),
  // How the prospect sounds. Unknown values are ignored.
  personality: z.string().max(30).optional(),
  mood: z.string().max(30).optional(),
});

// Light per-user limit so a stuck page can't burn through the ElevenLabs allowance. (In memory: per server instance.)
const hits = new Map<string, number[]>();
function tooMany(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 90;
}

// Turns the prospect's reply (or one line of it) into streaming speech with an ElevenLabs voice.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (tooMany(auth.user.id)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (!elevenLabsEnabled()) {
    console.error("[tts] ELEVENLABS_API_KEY is not set, so the prospect has no voice. Add it to .env.local (or Render's Environment).");
    return NextResponse.json({ error: "Voice is not configured" }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { text, voiceSeed, personality, mood } = parsed.data;

  try {
    const first = voiceSeed.split(/\s+/)[0]?.toLowerCase() ?? "";
    const feminine = config.personas.name_pools.feminine_first_names.some((n) => n.toLowerCase() === first);
    const accent = pickAccent(voiceSeed, config.ai.tts.accent.uk_percent);
    const voiceId = await pickElevenVoice(voiceSeed, feminine, accent);
    const upstream = await streamElevenLabsSpeech({ text: speakable(text), voiceId, personality, mood });
    if (process.env.NODE_ENV !== "production") {
      console.log(`[tts] ElevenLabs voice ${voiceId} (${accent}, ${feminine ? "feminine" : "masculine"}) mood=${mood ?? "-"}`);
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "audio/pcm", "Cache-Control": "no-store", "X-TTS-Backend": "elevenlabs" },
    });
  } catch (err) {
    if (err instanceof ElevenSetupError) console.error(`[tts] ELEVENLABS SETUP PROBLEM. ${err.message}`);
    else console.error("tts: failed", err);
    return NextResponse.json({ error: "Speech failed" }, { status: err instanceof ElevenSetupError ? 503 : 502 });
  }
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
