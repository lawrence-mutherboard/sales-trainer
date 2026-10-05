import { BrowserSynth, synthSupported } from "./synth";
import { ServerTtsSynth } from "./ttsServer";
import type { Synth } from "./types";

// Which voice speaks for the prospect. Set NEXT_PUBLIC_TTS_PROVIDER=elevenlabs in .env.local for the natural voice
// (needs ELEVENLABS_API_KEY on the server). Anything else uses the free browser voice.
export function ttsProvider(): "browser" | "elevenlabs" {
  return process.env.NEXT_PUBLIC_TTS_PROVIDER === "elevenlabs" ? "elevenlabs" : "browser";
}

export function speechOutputSupported(): boolean {
  return ttsProvider() === "elevenlabs" || synthSupported();
}

export function createSynth(now: () => number, onSpeakingChange: (speaking: boolean) => void): Synth {
  return ttsProvider() === "elevenlabs" ? new ServerTtsSynth(now, onSpeakingChange) : new BrowserSynth(now, onSpeakingChange);
}
