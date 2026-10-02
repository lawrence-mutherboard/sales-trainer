import { createSynth, speechOutputSupported } from "./synthFactory";
import type { SpeakSpan, Synth, UserUtterance, VoiceAdapter, VoiceStartOptions } from "./types";

// Fallback when the microphone is unavailable: the rep types, the prospect can still be heard (if the
// browser can speak) or read on screen. Talk ratio is not measured for typed calls.
export class TypedVoiceAdapter implements VoiceAdapter {
  readonly kind = "typed" as const;
  readonly usesMic = false;

  private now: () => number = () => 0;
  private synth: Synth | null = null;
  private speechCbs = new Set<(u: UserUtterance) => void>();
  private speakingCbs = new Set<(s: boolean) => void>();

  onSpeaking(cb: (s: boolean) => void) {
    this.speakingCbs.add(cb);
    return () => void this.speakingCbs.delete(cb);
  }

  constructor(private speakReplies: boolean = true) {}

  async start(opts: VoiceStartOptions): Promise<void> {
    this.now = opts.now;
    if (this.speakReplies && speechOutputSupported()) {
      this.synth = createSynth(this.now, (s) => this.speakingCbs.forEach((cb) => cb(s)));
      await this.synth.init(opts.voiceSeed, opts.personality);
    }
  }

  /** Called by the UI when the rep presses send. */
  submit(text: string) {
    const endedMs = this.now();
    // Typed turns have no real speaking time; estimate from length so timestamps stay in order.
    const startedMs = Math.max(0, endedMs - Math.round((text.split(/\s+/).length / 2.5) * 1000));
    this.speechCbs.forEach((cb) => cb({ text, startedMs, endedMs }));
  }

  onUserSpeech(cb: (u: UserUtterance) => void) {
    this.speechCbs.add(cb);
    return () => void this.speechCbs.delete(cb);
  }
  onInterim() {
    return () => {};
  }
  onError() {
    return () => {};
  }

  prepare(texts: string[]): Promise<void> {
    return this.synth ? this.synth.preload(texts) : Promise.resolve();
  }

  speak(text: string, mood?: string | null): Promise<SpeakSpan> {
    if (!this.synth) return Promise.resolve({ startedMs: this.now(), endedMs: this.now() });
    return this.synth.speak(text, mood);
  }
  cancelSpeech() {
    this.synth?.cancel();
  }
  stop() {
    this.synth?.dispose();
  }
}
