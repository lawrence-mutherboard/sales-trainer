import { BrowserSynth, synthSupported } from "./synth";
import { decodePcm16, PCM_SAMPLE_RATE } from "./pcm";
import type { SpeakSpan, Synth } from "./types";

// Natural prospect voice: text is turned into speech by the server (/api/tts, ElevenLabs) and played as it streams in, so speech starts before the whole clip has been generated.
// The voice stays the same all call, because the server picks it from the prospect's name.
// If a request fails twice, that piece falls back to the browser voice so the call keeps going.

/** Wait for this much audio before starting playback, so a slow network doesn't make it stutter. */
const PREBUFFER_SECONDS = 0.25;

type Source = { kind: "bytes"; data: Uint8Array } | { kind: "stream"; response: Response };

export class ServerTtsSynth implements Synth {
  private seed = "";
  private personality = "";
  private cache = new Map<string, Promise<Uint8Array>>();
  private chain: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private pending = 0;
  private speaking = false;
  private cancelled = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopCurrent: (() => void) | null = null;
  private fallback: BrowserSynth | null = null;
  private ctx: AudioContext | null = null;

  constructor(
    private now: () => number,
    private onSpeakingChange: (speaking: boolean) => void,
  ) {}

  async init(voiceSeed: string, personality = "") {
    this.seed = voiceSeed;
    this.personality = personality;
    // Created here because init runs from the "Start call" click, which is what lets the browser play audio.
    try {
      this.ctx = new AudioContext();
      await this.ctx.resume();
    } catch (err) {
      console.error("Couldn't start audio playback", err);
    }
    if (synthSupported()) {
      this.fallback = new BrowserSynth(this.now, () => {});
      await this.fallback.init(voiceSeed);
    }
  }

  private async request(text: string, mood: string | null | undefined): Promise<Response> {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceSeed: this.seed, personality: this.personality || undefined, mood: mood || undefined }),
    });
    if (!r.ok || !r.body) throw new Error(`tts ${r.status}`);
    return r;
  }

  /** Downloads short phrases (fillers like "Mm.") now, so they can start playing the instant they are needed. */
  async preload(texts: string[]): Promise<void> {
    await Promise.allSettled(
      texts.map((t) => {
        if (this.cache.has(t)) return Promise.resolve();
        const p = this.request(t, null)
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b));
        this.cache.set(t, p);
        p.catch(() => this.cache.delete(t));
        return p;
      }),
    );
  }

  speak(text: string, mood?: string | null): Promise<SpeakSpan> {
    const instant = () => ({ startedMs: this.now(), endedMs: this.now() });
    if (this.cancelled) return Promise.resolve(instant());

    const gen = this.generation;
    // Start fetching straight away (in parallel with whatever is playing). Prepared fillers are already downloaded.
    const cached = !mood ? this.cache.get(text) : undefined;
    const source: Promise<Source> = cached
      ? cached.then((data) => ({ kind: "bytes", data }) as Source)
      : this.request(text, mood).then((response) => ({ kind: "stream", response }) as Source);
    source.catch(() => {}); // handled below; stops an "unhandled rejection" warning if we're cancelled first

    this.pending += 1;
    const run = this.chain
      .then(async (): Promise<SpeakSpan> => {
        if (gen !== this.generation) {
          source
            .then((s) => {
              if (s.kind === "stream") void s.response.body?.cancel();
            })
            .catch(() => {});
          return instant();
        }
        let src: Source | null = null;
        try {
          src = await source;
        } catch (err) {
          console.warn("TTS request failed, retrying once", err);
          try {
            src = { kind: "stream", response: await this.request(text, mood) };
          } catch (err2) {
            console.error("TTS failed twice, using the browser voice for this line (the voice will change)", err2);
          }
        }
        if (gen !== this.generation) {
          if (src?.kind === "stream") src.response.body?.cancel().catch(() => {});
          return instant();
        }
        if (!src || !this.ctx) {
          this.setSpeaking(true);
          return this.fallback ? this.fallback.speak(text) : instant();
        }
        return this.play(src, this.ctx);
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
        if (this.pending === 0) {
          this.idleTimer = setTimeout(() => this.setSpeaking(false), 300);
        }
      });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private setSpeaking(s: boolean) {
    if (s && this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.speaking !== s) {
      this.speaking = s;
      this.onSpeakingChange(s);
    }
  }

  /** Plays raw PCM audio as it arrives, scheduling each piece to start exactly when the previous one ends. */
  private async play(src: Source, ctx: AudioContext): Promise<SpeakSpan> {
    await ctx.resume().catch(() => {});

    const nodes: AudioBufferSourceNode[] = [];
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let stopped = false;
    let resolveEnd!: () => void;
    const ended = new Promise<void>((r) => (resolveEnd = r));
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      reader?.cancel().catch(() => {});
      resolveEnd();
    };
    this.stopCurrent = stop;

    let startedMs = this.now();
    let nextTime = 0;
    let began = false;
    let carry: Uint8Array | null = null;
    let held: Float32Array[] = [];
    let heldSeconds = 0;

    const schedule = (samples: Float32Array) => {
      const buffer = ctx.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      const at = Math.max(nextTime, ctx.currentTime + 0.02);
      node.start(at);
      nextTime = at + buffer.duration;
      nodes.push(node);
      if (!began) {
        began = true;
        startedMs = this.now();
        this.setSpeaking(true);
      }
    };
    const releaseHeld = () => {
      for (const s of held) schedule(s);
      held = [];
      heldSeconds = 0;
    };
    const onBytes = (bytes: Uint8Array) => {
      const out = decodePcm16(bytes, carry);
      carry = out.carry;
      if (!out.samples.length) return;
      if (began) return schedule(out.samples);
      held.push(out.samples);
      heldSeconds += out.samples.length / PCM_SAMPLE_RATE;
      if (heldSeconds >= PREBUFFER_SECONDS) releaseHeld();
    };

    try {
      if (src.kind === "bytes") {
        onBytes(src.data);
      } else {
        reader = src.response.body!.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          if (value) onBytes(value);
        }
      }
    } catch (err) {
      if (!stopped) console.error("TTS playback error", err);
    }

    if (!stopped) {
      if (!began) releaseHeld(); // short clip: it never reached the prebuffer size
      if (began) {
        const remainingMs = Math.max(0, (nextTime - ctx.currentTime) * 1000);
        setTimeout(resolveEnd, remainingMs + 30);
      } else {
        resolveEnd();
      }
    }
    await ended;
    if (this.stopCurrent === stop) this.stopCurrent = null;
    return { startedMs, endedMs: this.now() };
  }

  cancel() {
    this.generation += 1;
    this.stopCurrent?.();
    this.fallback?.cancel();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.pending = 0;
    this.setSpeaking(false);
  }

  dispose() {
    this.cancelled = true;
    this.cancel();
    this.fallback?.dispose();
    void this.ctx?.close().catch(() => {});
  }
}
