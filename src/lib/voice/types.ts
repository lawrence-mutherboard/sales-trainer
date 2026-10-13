// The voice layer is behind this one interface so the free browser voice can be swapped for a managed
// platform (Vapi, Retell + ElevenLabs) later without touching the call flow or the API routes.
//
// All times are milliseconds on the CALL CLOCK (0 = the moment the call connected), supplied via start({ now }).

export interface UserUtterance {
  text: string;
  startedMs: number;
  endedMs: number;
}

export interface SpeakSpan {
  startedMs: number;
  endedMs: number;
}

export interface VoiceStartOptions {
  /** Returns ms since the call connected. */
  now: () => number;
  /** Stable string (e.g. the prospect's name) used to pick a consistent voice for this call. */
  voiceSeed: string;
  /** The prospect's personality key (friendly, uninterested, skeptical). Shapes how the voice sounds. */
  personality?: string;
  /** True if the rep wears headphones: the mic can stay open while the prospect talks. */
  headphones?: boolean;
  /** How long to wait after the rep stops before treating their turn as finished (config/listening.json). */
  turnTiming?: import("./turnTiming").TurnTimingConfig;
}

export interface VoiceAdapter {
  readonly kind: "browser" | "typed" | "vapi" | "retell";
  /** True when the adapter listens through the microphone. */
  readonly usesMic: boolean;

  /** Begin listening. Rejects with a human-readable Error if it can't (mic blocked, unsupported browser...). */
  start(opts: VoiceStartOptions): Promise<void>;
  stop(): void;

  /** The rep finished a turn. Returns an unsubscribe function. */
  onUserSpeech(cb: (u: UserUtterance) => void): () => void;
  /** Live partial transcript while the rep is talking (for captions). */
  onInterim(cb: (text: string) => void): () => void;
  /** The prospect started or stopped talking (for the "speaking" indicator). */
  onSpeaking(cb: (speaking: boolean) => void): () => void;
  /** Recoverable or fatal problems, as messages safe to show the rep. */
  onError(cb: (message: string) => void): () => void;

  /**
   * Speak one chunk (a sentence). Chunks are queued; the promise resolves when this chunk has been spoken.
   * `mood` (for example "impatient") changes how it sounds. Unknown or missing = neutral.
   */
  speak(text: string, mood?: string | null): Promise<SpeakSpan>;
  /** Get short phrases ready to play instantly later (used for "mm" / "right" fillers). Safe to skip. */
  prepare(texts: string[]): Promise<void>;
  /** Drop anything queued or currently being spoken. */
  cancelSpeech(): void;
  /** True if the rep is making sound right now (so the prospect should not talk over them). Optional. */
  isUserSpeaking?(): boolean;
  /** True while the rep's last turn is still being finished or transcribed (so they are not silent). Optional. */
  isTurnPending?(): boolean;
}

/** Speaks the prospect's replies. Implemented by the free browser voice and by the natural server voice. */
export interface Synth {
  init(voiceSeed: string, personality?: string): Promise<void>;
  /** Queue one chunk (a sentence). Resolves when that chunk has finished playing. */
  speak(text: string, mood?: string | null): Promise<SpeakSpan>;
  /** Download or prepare short phrases so speak() of the same text (with no mood) starts instantly. */
  preload(texts: string[]): Promise<void>;
  /** Drop anything queued or playing. The synth stays usable afterwards. */
  cancel(): void;
  /** Permanently stop (call ended). */
  dispose(): void;
}
