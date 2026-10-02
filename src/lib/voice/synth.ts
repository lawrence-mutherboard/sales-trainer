import type { SpeakSpan, Synth } from "./types";

// Prospect voice using the browser's speechSynthesis (free). Prefers en-GB voices.

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function waitForVoices(timeoutMs: number): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const have = window.speechSynthesis.getVoices();
    if (have.length) return resolve(have);
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

export function synthSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export class BrowserSynth implements Synth {
  private voice: SpeechSynthesisVoice | null = null;
  private pending = 0;
  private speaking = false;
  private cancelled = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private now: () => number,
    /** Called with true when the first chunk starts and false ~300ms after the last chunk ends. */
    private onSpeakingChange: (speaking: boolean) => void,
  ) {}

  private personality = "";

  async init(voiceSeed: string, personality = "") {
    this.personality = personality;
    const voices = await waitForVoices(1500);
    const gb = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("en-gb"));
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    const pool = gb.length ? gb : en;
    this.voice = pool.length ? pool[hash(voiceSeed) % pool.length] : null;
  }

  /** Nothing to download for the browser voice. */
  async preload(): Promise<void> {}

  speak(text: string, mood?: string | null): Promise<SpeakSpan> {
    return new Promise((resolve) => {
      if (this.cancelled) return resolve({ startedMs: this.now(), endedMs: this.now() });
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      if (this.voice) u.voice = this.voice;
      // The browser voice can only change pace, so mood and personality nudge the speed a little.
      const personalityRate: Record<string, number> = { friendly: 1.05, uninterested: 0.95, skeptical: 1.0 };
      const moodRate: Record<string, number> = { impatient: 0.1, irritated: 0.1, distracted: -0.05, amused: 0.03 };
      u.rate = (personalityRate[this.personality] ?? 1.0) + (mood ? (moodRate[mood] ?? 0) : 0);
      let startedMs = this.now();

      u.onstart = () => {
        startedMs = this.now();
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        if (!this.speaking) {
          this.speaking = true;
          this.onSpeakingChange(true);
        }
      };
      const finish = () => {
        this.pending = Math.max(0, this.pending - 1);
        if (this.pending === 0) {
          // Small delay so the mic doesn't hear the tail of the prospect's voice.
          this.idleTimer = setTimeout(() => {
            this.speaking = false;
            this.onSpeakingChange(false);
          }, 300);
        }
        resolve({ startedMs, endedMs: this.now() });
      };
      u.onend = finish;
      u.onerror = finish;

      this.pending += 1;
      window.speechSynthesis.speak(u);
    });
  }

  /** Drop anything queued or playing. The synth stays usable afterwards. */
  cancel() {
    window.speechSynthesis.cancel();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.pending = 0;
    this.speaking = false;
    this.onSpeakingChange(false);
  }

  /** Permanently stop (call ended). Later speak() calls resolve immediately. */
  dispose() {
    this.cancelled = true;
    this.cancel();
  }
}
