import { encodeWav16, plausibleTranscript, trimSilence } from "./audio";
import { PcmRecorder, recorderSupported } from "./recorder";
import { punctuateTurn } from "./punctuate";
import { DEFAULT_TURN_TIMING, waitAfterPhraseMs, type TurnTimingConfig } from "./turnTiming";
import { createSynth, speechOutputSupported } from "./synthFactory";
import type { SpeakSpan, Synth, UserUtterance, VoiceAdapter, VoiceStartOptions } from "./types";

// Free voice: Web Speech API for speech-to-text, speechSynthesis for the prospect. Chrome/Edge only.
// Note: Chrome's speech recognition sends audio to Google's servers (mention this in the privacy notice).

/**
 * How long the rep must be silent before we treat their turn as finished. Shorter feels more like a real
 * conversation but risks cutting people off mid-thought when they pause. After Chrome has finalised a phrase
 * we wait less than while it is still guessing.
 */

/**
 * Accurate transcription (NEXT_PUBLIC_STT_PROVIDER=openai): Chrome still gives the live captions and decides when a turn
 * has ended, but the words come from re-transcribing the recorded audio, which understands context ("bad time", not "bed time").
 * If that is slow or fails, the browser's own text is used instead.
 */
/** The longest the app will keep a turn open past the normal wait just because the microphone still hears sound. */
const MAX_EXTRA_WAIT_MS = 8000;

const ACCURATE_STT = process.env.NEXT_PUBLIC_STT_PROVIDER === "openai";
const TRANSCRIBE_TIMEOUT_MS = 3500;

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserVoiceSupported(): boolean {
  return getRecognitionCtor() !== null && speechOutputSupported();
}

export class BrowserVoiceAdapter implements VoiceAdapter {
  readonly kind = "browser" as const;
  readonly usesMic = true;

  private now: () => number = () => 0;
  private recognition: Recognition | null = null;
  private synth: Synth | null = null;

  private active = false;
  private micPaused = false;
  /** Headphones mode: the mic stays open while the prospect talks (so your first words are not lost); what it hears then is ignored. */
  private headphones = false;
  private ignoreResults = false;

  private buffer = "";
  /** The phrases Chrome has settled on in the current turn (it splits a turn where the rep pauses). */
  private pieces: string[] = [];
  private bufStart: number | null = null;
  private lastResultAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Accurate transcription state
  private recorder: PcmRecorder | null = null;
  /** Where in the recording the current turn can start (after the prospect finished talking / the previous turn ended). */
  private segmentFloor = 0;
  /** A transcription started as soon as you paused, so it is usually ready by the time the turn is confirmed finished. */
  private spec: { floor: number; endSample: number; promise: Promise<string | null> } | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  /** Turns that have ended but are still being transcribed / handed on. While this is above zero the rep is not "silent". */
  private pendingTurns = 0;
  private timing: TurnTimingConfig = DEFAULT_TURN_TIMING;


  private speechCbs = new Set<(u: UserUtterance) => void>();
  private interimCbs = new Set<(t: string) => void>();
  private errorCbs = new Set<(m: string) => void>();
  private speakingCbs = new Set<(s: boolean) => void>();

  onSpeaking(cb: (s: boolean) => void) {
    this.speakingCbs.add(cb);
    return () => void this.speakingCbs.delete(cb);
  }

  onUserSpeech(cb: (u: UserUtterance) => void) {
    this.speechCbs.add(cb);
    return () => void this.speechCbs.delete(cb);
  }
  onInterim(cb: (t: string) => void) {
    this.interimCbs.add(cb);
    return () => void this.interimCbs.delete(cb);
  }
  onError(cb: (m: string) => void) {
    this.errorCbs.add(cb);
    return () => void this.errorCbs.delete(cb);
  }
  private emitError(m: string) {
    this.errorCbs.forEach((cb) => cb(m));
  }

  async start(opts: VoiceStartOptions): Promise<void> {
    const Ctor = getRecognitionCtor();
    if (!Ctor || !speechOutputSupported()) {
      throw new Error("This browser doesn't support voice calls. Use Chrome or Edge, or type your replies instead.");
    }
    this.now = opts.now;
    this.headphones = Boolean(opts.headphones);
    this.timing = opts.turnTiming ?? DEFAULT_TURN_TIMING;

    // Ask for the mic up front so a blocked mic gives a clear message before the call starts.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      throw new Error("Microphone access was blocked. Allow it in the address bar, or type your replies instead.");
    }

    if (recorderSupported()) {
      try {
        const recorder = new PcmRecorder();
        await recorder.start();
        this.recorder = recorder;
      } catch (err) {
        console.warn("Accurate transcription unavailable, using the browser's recognition only", err);
        this.recorder = null;
      }
    }

    this.synth = createSynth(this.now, (speaking) => this.onSpeakingChange(speaking));
    await this.synth.init(opts.voiceSeed, opts.personality);

    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onspeechstart = () => {
      if (this.bufStart == null) this.bufStart = this.now();
    };

    rec.onresult = (e) => {
      if (this.ignoreResults) return; // headphones mode: not the rep, so drop it
      const at = this.now();
      this.lastResultAt = at;
      if (this.bufStart == null) this.bufStart = at;

      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim();
          if (t) {
            this.pieces.push(t);
            this.buffer += `${this.buffer ? " " : ""}${t}`;
          }
        }
        else interim += r[0].transcript;
      }
      const live = `${this.buffer}${interim ? ` ${interim.trim()}` : ""}`.trim();
      if (live) this.interimCbs.forEach((cb) => cb(live));

      const stillGuessing = interim.trim().length > 0;
      // More speech invalidates any transcription started earlier. Once Chrome has settled on a phrase, start
      // transcribing it now, in the background, while we wait to be sure you have finished.
      this.spec = null;
      if (ACCURATE_STT && this.recorder && !stillGuessing && this.buffer) {
        const floor = this.segmentFloor;
        const endSample = this.recorder.currentSample();
        this.spec = { floor, endSample, promise: this.transcribe(floor, endSample) };
      }
      this.armFlush(stillGuessing);
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.emitError("Microphone access was blocked. Type your replies instead.");
      } else if (e.error === "network") {
        this.emitError("Speech recognition lost its connection. Check your internet, or type your replies.");
      } else if (e.error === "audio-capture") {
        this.emitError("No microphone was found. Type your replies instead.");
      } else {
        this.emitError(`Speech recognition problem (${e.error}).`);
      }
    };

    // Chrome ends recognition on its own from time to time; keep it going while the call is live.
    rec.onend = () => {
      if (this.active && !this.micPaused) setTimeout(() => this.startRecognition(), 50);
    };

    this.recognition = rec;
    this.active = true;
    this.startRecognition();
  }

  private startRecognition() {
    if (!this.active || this.micPaused || !this.recognition) return;
    try {
      this.recognition.start();
    } catch {
      // Already started - fine.
    }
  }

  private armFlush(stillGuessing: boolean) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    // Wait longer if the rep stopped mid-sentence ("...and", "...the"), less if they clearly finished.
    const wait = stillGuessing ? this.timing.guessingMs : waitAfterPhraseMs(this.buffer, this.timing);
    const armedAt = Date.now();
    this.flushTimer = setTimeout(() => this.finishTurnIfQuiet(armedAt), wait);
  }

  /**
   * The wait above is counted from the browser's last result, but in a long stretch of speech the browser delivers
   * results in bursts, with gaps of a second or more. So before ending the turn, check the microphone itself: if
   * the rep is still audibly talking, keep waiting. (Capped, so a noisy room can't hold a turn open for ever.)
   */
  private finishTurnIfQuiet(armedAt: number) {
    if (this.recorder?.isSpeechNow() && Date.now() - armedAt < MAX_EXTRA_WAIT_MS) {
      this.flushTimer = setTimeout(() => this.finishTurnIfQuiet(armedAt), 250);
      return;
    }
    this.flush();
  }

  /**
   * True while any part of the rep's turn is still being handled: words waiting to be confirmed as finished, or a finished
   * turn that is being transcribed. The "are you still there?" countdown must not run during this time.
   */
  isTurnPending(): boolean {
    return this.pendingTurns > 0 || this.buffer.trim().length > 0 || this.flushTimer !== null;
  }

  /** True if the microphone is hearing the rep right now. */
  isUserSpeaking(): boolean {
    return this.recorder ? this.recorder.isSpeechNow(1000) : false; // 1 s window, so a breath between words doesn't count as silence
  }

  /** Cuts the given stretch of the recording, trims the silence, and asks the server to transcribe it. Null = use the browser's text. */
  private async transcribe(from: number, to: number): Promise<string | null> {
    const rec = this.recorder;
    if (!rec) return null;
    const pcm = rec.slice(from, to);
    const range = trimSilence(pcm, rec.sampleRate);
    if (!range) return null; // no real speech in the recording, so there is nothing to transcribe
    const wav = encodeWav16(pcm.subarray(range.start, range.end), rec.sampleRate);

    const form = new FormData();
    form.append("audio", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "speech.wav");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: abort.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as { text?: string };
      return data.text?.trim() || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Chrome gives no punctuation, so add capitals, commas, full stops and question marks.
    const text = punctuateTurn(this.pieces) || this.buffer.trim();
    const startedMs = this.bufStart ?? this.lastResultAt;
    const endedMs = Math.max(this.lastResultAt, startedMs);
    const spec = this.spec;
    const rec = this.recorder;
    const floor = this.segmentFloor;
    const endSample = rec ? rec.currentSample() : 0;
    this.spec = null;
    this.buffer = "";
    this.pieces = [];
    this.bufStart = null;
    if (!text) return;
    if (rec) this.segmentFloor = endSample; // the next turn starts where this one ended
    this.interimCbs.forEach((cb) => cb(""));

    // Turns are handed on in order, even if one transcription takes longer than the next.
    this.pendingTurns += 1;
    this.flushChain = this.flushChain.then(async () => {
      let finalText = text;
      if (rec && ACCURATE_STT) {
        const reusable = spec !== null && spec.floor === floor && endSample - spec.endSample < 0.4 * rec.sampleRate;
        const better = await (reusable ? spec.promise : this.transcribe(floor, endSample));
        if (better && plausibleTranscript(better, text)) finalText = better;
        else if (better) console.warn("Ignoring an implausible transcription", { better, browser: text });
      }
      this.speechCbs.forEach((cb) => cb({ text: finalText, startedMs, endedMs }));
    }).finally(() => {
      this.pendingTurns = Math.max(0, this.pendingTurns - 1);
    });
  }

  /** The mic is muted while the prospect talks, so the app can't hear the speakers. Use headphones. */
  private onSpeakingChange(speaking: boolean) {
    this.speakingCbs.forEach((cb) => cb(speaking));
    if (speaking) {
      this.flush();
      if (this.headphones) {
        // Keep the mic warm; just ignore anything it hears until the prospect stops.
        this.ignoreResults = true;
        this.buffer = "";
        this.pieces = [];
        this.bufStart = null;
      } else {
        this.micPaused = true;
        try {
          this.recognition?.abort();
        } catch {
          /* ignore */
        }
      }
    } else {
      this.ignoreResults = false;
      this.micPaused = false;
      this.startRecognition();
      // Your next turn can only start after the prospect stopped (the speaking flag drops about 0.3 s after they finish).
      if (this.recorder) {
        const back = Math.round(0.35 * this.recorder.sampleRate);
        this.segmentFloor = Math.max(this.segmentFloor, this.recorder.currentSample() - back);
      }
    }
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
    this.active = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    try {
      this.recognition?.abort();
    } catch {
      /* ignore */
    }
    this.recorder?.stop();
    this.recorder = null;
    this.synth?.dispose();
  }
}
