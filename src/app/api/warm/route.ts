import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { anthropic } from "@/lib/ai/client";
import { elevenLabsEnabled, warmElevenLabs } from "@/lib/ai/elevenlabs";

export const runtime = "nodejs";

// Called by the call screen while the phone is ringing. The first request to each service on a fresh connection is slow
// (name lookup, secure handshake), so this opens those connections now, with harmless "list" requests, instead of making
// the first spoken sentence pay for them. Nothing is created and nothing is charged.
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const timed = async (name: string, job: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      await job();
      return `${name} ${Date.now() - t0} ms`;
    } catch {
      return `${name} failed`;
    }
  };

  const results = await Promise.all([
    timed("claude", () => anthropic().models.list({ limit: 1 })),
    timed(
      "elevenlabs",
      async () => {
        if (!elevenLabsEnabled()) return;
        warmElevenLabs();
        await fetch("https://api.elevenlabs.io/v1/models", { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } });
      },
    ),
    timed("openai", async () => {
      if (!process.env.OPENAI_API_KEY) return;
      await fetch("https://api.openai.com/v1/models/gpt-4o-mini-transcribe", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    }),
  ]);
  console.log(`[warm] ${results.join(", ")}`);
  return NextResponse.json({ ok: true });
}
