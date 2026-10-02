import { NextResponse } from "next/server";
import { toFile } from "openai";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/api/auth";
import { openai } from "@/lib/ai/openaiProvider";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // ~2 minutes of 16 kHz audio

// Light per-user limit so a stuck page can't burn through the OpenAI budget. (In memory: per server instance.)
const hits = new Map<string, number[]>();
function tooMany(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 60;
}

// Turns one clip of the rep's speech into text, more accurately than the browser can. The audio is sent to OpenAI
// for transcription only. It is not stored by this app.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (tooMany(auth.user.id)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob)) return NextResponse.json({ error: "No audio" }, { status: 400 });
  if (audio.size < 1000 || audio.size > MAX_BYTES) return NextResponse.json({ error: "Bad audio size" }, { status: 400 });

  const stt = config.ai.stt;
  const vocabulary = [...new Set([...stt.vocabulary, ...config.speechCorrections.map((c) => c.said)])];
  const prompt = `${stt.prompt} Words and names that may come up: ${vocabulary.join(", ")}.`;

  try {
    const file = await toFile(Buffer.from(await audio.arrayBuffer()), "speech.wav", { type: "audio/wav" });
    const result = await openai().audio.transcriptions.create({
      file,
      model: stt.model,
      language: "en",
      prompt,
    });
    return NextResponse.json({ text: (result as { text?: string }).text ?? "" });
  } catch (err) {
    console.error("transcribe: failed", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }
}
