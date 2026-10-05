import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/api/auth";
import { elevenLabsEnabled, transcribeWithScribe } from "@/lib/ai/elevenlabs";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // ~2 minutes of 16 kHz audio

// Light per-user limit so a stuck page can't burn through the ElevenLabs budget. (In memory: per server instance.)
const hits = new Map<string, number[]>();
function tooMany(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 60;
}

// Turns one clip of the rep's speech into text, more accurately than the browser can, using ElevenLabs Scribe.
// The audio is sent to ElevenLabs for transcription only. It is not stored by this app.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (tooMany(auth.user.id)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  if (!elevenLabsEnabled()) return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob)) return NextResponse.json({ error: "No audio" }, { status: 400 });
  if (audio.size < 1000 || audio.size > MAX_BYTES) return NextResponse.json({ error: "Bad audio size" }, { status: 400 });

  const keyterms = [...new Set([...config.ai.stt.vocabulary, ...config.speechCorrections.map((c) => c.said)])];

  try {
    const text = await transcribeWithScribe(audio, keyterms);
    return NextResponse.json({ text });
  } catch (err) {
    console.error("transcribe: failed", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }
}
