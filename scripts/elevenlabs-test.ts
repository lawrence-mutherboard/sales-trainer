// Run with: npm run test:elevenlabs
// Checks the ElevenLabs voice end to end with your key: picks a British and an American voice the same way the app
// does, asks each to say a line in the raw 24 kHz format the player expects, and prints the time to first audio and the
// length of speech. Costs a tiny number of characters from your plan.
import Module from "node:module";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine if missing */
}
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is empty in .env.local");
  const { pickElevenVoice, streamElevenLabsSpeech, voiceSettings } = await import("../src/lib/ai/elevenlabs");

  const cases = [
    { who: "feminine, British", feminine: true, accent: "uk" as const, mood: "neutral" },
    { who: "masculine, British", feminine: false, accent: "uk" as const, mood: "impatient" },
    { who: "feminine, American", feminine: true, accent: "us" as const, mood: "warm" },
  ];
  for (const c of cases) {
    const voiceId = await pickElevenVoice(`Test ${c.who}`, c.feminine, c.accent);
    const t0 = Date.now();
    const res = await streamElevenLabsSpeech({ text: "Go on then, but I have only got a couple of minutes. What is this about?", voiceId, personality: "skeptical", mood: c.mood });
    const reader = res.body!.getReader();
    let total = 0;
    let first: number | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (first === null) first = Date.now() - t0;
      total += value.length;
    }
    const s = voiceSettings("skeptical", c.mood);
    console.log(
      `${c.who.padEnd(20)} voice ${voiceId}  first audio ${first} ms, total ${Date.now() - t0} ms, ${(total / 2 / 24000).toFixed(1)} s of speech  (stability ${s.stability.toFixed(2)}, speed ${s.speed.toFixed(2)})`,
    );
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
