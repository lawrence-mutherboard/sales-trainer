import { BrowserVoiceAdapter, browserVoiceSupported } from "./browser";
import { TypedVoiceAdapter } from "./typed";
import type { VoiceAdapter } from "./types";

export type { VoiceAdapter, UserUtterance, SpeakSpan } from "./types";
export { browserVoiceSupported };

export type VoiceMode = "voice" | "typed";

/**
 * The single place that decides which voice implementation the call uses.
 * Phase 2: add `VapiAdapter` / `RetellAdapter` (implementing VoiceAdapter) and return them here,
 * driven by an env var, e.g. NEXT_PUBLIC_VOICE_PROVIDER. Nothing else in the app needs to change.
 */
export function createVoiceAdapter(mode: VoiceMode): VoiceAdapter {
  if (mode === "typed") return new TypedVoiceAdapter(true);
  return new BrowserVoiceAdapter();
}
