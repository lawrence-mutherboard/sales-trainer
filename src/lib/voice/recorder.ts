import { speechThreshold, updateNoiseFloor } from "./audio";

// Keeps the last couple of minutes of microphone audio in memory (16 kHz mono), so any part of the call can be
// cut out exactly and sent for accurate transcription. Nothing is stored or uploaded except the clips that are
// explicitly transcribed, and those are not kept by the app (see /api/transcribe).

const SAMPLE_RATE = 16000;
const KEEP_SECONDS = 150;

// Runs on the audio thread: collects 100 ms of samples at a time and hands them to the page.
const WORKLET_CODE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.len = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.buf.push(new Float32Array(ch));
      this.len += ch.length;
      if (this.len >= 1600) {
        const out = new Float32Array(this.len);
        let o = 0;
        for (const b of this.buf) { out.set(b, o); o += b.length; }
        this.port.postMessage(out, [out.buffer]);
        this.buf = []; this.len = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export function recorderSupported(): boolean {
  return typeof window !== "undefined" && "AudioWorkletNode" in window && !!navigator.mediaDevices?.getUserMedia;
}

export class PcmRecorder {
  readonly sampleRate = SAMPLE_RATE;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private chunks: { start: number; data: Float32Array }[] = [];
  private noiseFloor = 0.005;
  private total = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "text/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);
    // The node has to be connected to the output for the browser to keep running it; muted so nothing is heard.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  private push(data: Float32Array) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    this.noiseFloor = updateNoiseFloor(this.noiseFloor, Math.sqrt(sum / Math.max(1, data.length)));
    this.chunks.push({ start: this.total, data });
    this.total += data.length;
    const keep = KEEP_SECONDS * SAMPLE_RATE;
    while (this.chunks.length > 1 && this.total - this.chunks[0].start > keep) this.chunks.shift();
  }

  /** How many samples have been recorded so far. Use it as a position marker. */
  currentSample(): number {
    return this.total;
  }

  /** Loudness (RMS, 0..1) of the most recent audio. Used to tell whether the rep is talking right now. */
  recentRms(ms: number): number {
    const need = Math.round((ms / 1000) * SAMPLE_RATE);
    let sum = 0;
    let count = 0;
    for (let i = this.chunks.length - 1; i >= 0 && count < need; i--) {
      const d = this.chunks[i].data;
      for (let j = d.length - 1; j >= 0 && count < need; j--, count++) sum += d[j] * d[j];
    }
    return count ? Math.sqrt(sum / count) : 0;
  }

  /** True if the microphone is hearing speech right now (louder than the room's background noise). */
  isSpeechNow(ms = 400): boolean {
    return this.recentRms(ms) > speechThreshold(this.noiseFloor);
  }

  /** The audio between two position markers. */
  slice(from: number, to: number): Float32Array {
    const start = Math.max(from, this.chunks[0]?.start ?? 0);
    const end = Math.min(to, this.total);
    if (end <= start) return new Float32Array(0);
    const out = new Float32Array(end - start);
    for (const c of this.chunks) {
      const cEnd = c.start + c.data.length;
      if (cEnd <= start || c.start >= end) continue;
      const a = Math.max(start, c.start);
      const b = Math.min(end, cEnd);
      out.set(c.data.subarray(a - c.start, b - c.start), a - start);
    }
    return out;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.chunks = [];
  }
}
