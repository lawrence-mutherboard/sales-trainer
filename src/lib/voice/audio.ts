// Small pure audio helpers for the accurate-transcription path. No browser APIs, so they can be tested in Node.

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/**
 * Finds the part of a recording that actually contains speech, with a little padding either side.
 * Returns null when there is no speech at all. This stops the transcription model from "hearing"
 * words in silence (speech models tend to make up text such as "Thank you." when given quiet audio).
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  opts: { padStartMs?: number; padEndMs?: number; minSpeechMs?: number } = {},
): { start: number; end: number } | null {
  const frame = Math.max(1, Math.round(sampleRate * 0.02)); // 20 ms
  const frames = Math.floor(samples.length / frame);
  if (frames < 3) return null;

  const rms: number[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i] * samples[i];
    rms[f] = Math.sqrt(sum / frame);
  }

  // Background level = the quiet 20th percentile. Speech has to be clearly louder than that.
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.2)];
  const threshold = Math.max(0.01, noise * 3);

  let first = -1;
  let last = -1;
  let voiced = 0;
  for (let f = 0; f < frames; f++) {
    if (rms[f] > threshold) {
      voiced++;
      if (first < 0) first = f;
      last = f;
    }
  }
  const minFrames = Math.ceil((opts.minSpeechMs ?? 120) / 20);
  if (first < 0 || voiced < minFrames) return null;

  const padStart = Math.round(((opts.padStartMs ?? 300) / 1000) * sampleRate);
  const padEnd = Math.round(((opts.padEndMs ?? 400) / 1000) * sampleRate);
  return {
    start: Math.max(0, first * frame - padStart),
    end: Math.min(samples.length, (last + 1) * frame + padEnd),
  };
}

/** Rough check that a transcript is believable next to the browser's own guess (guards against invented text). */
export function plausibleTranscript(better: string, browserGuess: string): boolean {
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  const b = words(better);
  const c = words(browserGuess);
  if (b === 0) return false;
  if (b > c * 2.5 + 6) return false; // far more words than the browser heard: probably invented
  if (c >= 6 && b < c * 0.3) return false; // far fewer: probably lost most of the speech
  return true;
}

/**
 * Tracks the background noise level so "is someone talking?" works in a quiet room and a noisy one.
 * The floor drops straight to any quieter reading and creeps up slowly, so it follows the room, not the speech.
 */
export function updateNoiseFloor(floor: number, rms: number): number {
  return rms < floor ? rms : floor + (rms - floor) * 0.002;
}

/** The loudness above which audio counts as speech: well above the background, and never below a small minimum. */
export function speechThreshold(noiseFloor: number): number {
  return Math.max(0.015, noiseFloor * 3);
}
