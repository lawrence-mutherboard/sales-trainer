// Run with: npm run test:stt
// Checks the accurate-transcription request against the real OpenAI API. It has the OpenAI voice say a few
// sales-call sentences, then transcribes them the same way the app does (same model, same vocabulary hint),
// and prints what came back and how long it took. Costs a fraction of a cent.
// Note: computer-generated speech is much cleaner than a real microphone, so this checks the request and the
// vocabulary hint, not real-world accuracy. Judge that by making a call.
import Module from "node:module";
import OpenAI, { toFile } from "openai";

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
  const { config } = await import("../src/lib/config/index");
  const { encodeWav16 } = await import("../src/lib/voice/audio");
  const { decodePcm16 } = await import("../src/lib/voice/pcm");
  const client = new OpenAI();
  const stt = config.ai.stt;
  const vocabulary = [...new Set([...stt.vocabulary, ...config.speechCorrections.map((c) => c.said)])];
  const prompt = `${stt.prompt} Words and names that may come up: ${vocabulary.join(", ")}.`;
  console.log(`Model: ${stt.model}\n`);

  for (const line of LINES) {
    // 1) make some speech
    const speech = await client.audio.speech.create({ model: "gpt-4o-mini-tts", voice: "ash", input: line, response_format: "pcm" });
    const pcm = new Uint8Array(await speech.arrayBuffer());
    const { samples } = decodePcm16(pcm, null);
    const wav = encodeWav16(samples, 24000);

    // 2) transcribe it the way the app does
    const t0 = Date.now();
    const file = await toFile(Buffer.from(wav), "speech.wav", { type: "audio/wav" });
    const out = (await client.audio.transcriptions.create({ file, model: stt.model, language: "en", prompt })) as { text?: string };
    const ms = Date.now() - t0;
    console.log(`said : ${line}\nheard: ${out.text}\n(${ms} ms for ${(samples.length / 24000).toFixed(1)} s of audio)\n`);
  }
}
main().catch((e) => {
  console.error("FAILED:", e?.status, e?.message ?? e);
  process.exit(1);
});
