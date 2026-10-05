// Run with: npm run test:scribe
// Checks ElevenLabs speech-to-text (Scribe) with your key. It has an ElevenLabs voice say a few sales-call sentences,
// then transcribes them the same way the app does (same model, same vocabulary hints) and prints what came back and
// how long it took. Needs the key's Text to Speech, Voices (Read) and Speech to Text permissions. Costs a few characters
// and a few seconds of transcription on your plan.
// Note: computer-generated speech is much cleaner than a real microphone, so this checks the setup and the vocabulary
// hints, not real-world accuracy. Judge that by making a call.
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

const LINES = [
  "Hi, it's Sam from mutherboard. Is now a bad time to talk?",
  "We help teams get monday.com set up properly, so it actually gets used, especially the CRM side.",
  "So what does your current process look like for tracking deals in Salesforce or HubSpot?",
];

async function main() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is empty in .env.local");
  const { config } = await import("../src/lib/config/index");
  const { pickElevenVoice, streamElevenLabsSpeech, transcribeWithScribe } = await import("../src/lib/ai/elevenlabs");
  const { encodeWav16 } = await import("../src/lib/voice/audio");
  const { decodePcm16 } = await import("../src/lib/voice/pcm");

  const keyterms = [...new Set([...config.ai.stt.vocabulary, ...config.speechCorrections.map((c) => c.said)])];
  const voiceId = await pickElevenVoice("Scribe Test", false, "uk");
  console.log(`Speech-to-text model: ${config.ai.stt.model_id} (keyterms ${config.ai.stt.use_keyterms ? "on" : "off"}); test voice ${voiceId}\n`);

  for (const line of LINES) {
    const res = await streamElevenLabsSpeech({ text: line, voiceId });
    const pcm = new Uint8Array(await res.arrayBuffer());
    const { samples } = decodePcm16(pcm, null);
    const wav = encodeWav16(samples, 24000);

    const t0 = Date.now();
    const text = await transcribeWithScribe(new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), keyterms);
    console.log(`said : ${line}\nheard: ${text}\n(${Date.now() - t0} ms for ${(samples.length / 24000).toFixed(1)} s of audio)\n`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
