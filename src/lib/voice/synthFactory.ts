import { BrowserSynth, synthSupported } from "./synth";
import { ServerTtsSynth } from "./ttsServer";
import type { Synth } from "./types";

// Which voice speaks for the prospect. Set NEXT_PUBLIC_TTS_PROVIDER=openai in .env.local for the natural voice
// (needs OPENAI_API_KEY on the server). Anything else uses the free browser voice.
export function ttsProvider(): "browser" | "openai" {
  return process.env.NEXT_PUBLIC_TTS_PROVIDER === "openai" ? "openai" : "browser";
}

export function speechOutputSupported(): boolean {
  return ttsProvider() === "openai" || synthSupported();
}

export function createSynth(now: () => number, onSpeakingChange: (speaking: boolean) => void): Synth {
  return ttsProvider() === "openai" ? new ServerTtsSynth(now, onSpeakingChange) : new BrowserSynth(now, onSpeakingChange);
}
