// The ringing a caller hears while waiting for the other person to pick up (ringback tone), made with the Web Audio API
// so there is no audio file to download. British phones ring "brr-brr ... brr-brr" (400 + 450 Hz); American ones ring
// one long "brrrr" (440 + 480 Hz).

import type { Accent } from "./accent";

export interface Ringback {
  /** Resolves when the last ring has finished (the prospect "picks up" now), or as soon as stop() is called. */
  done: Promise<void>;
  stop(): void;
}

const PATTERNS: Record<Accent, { freqs: [number, number]; bursts: [number, number][]; cycleS: number }> = {
  // [start, length] of each burst within one cycle
  uk: { freqs: [400, 450], bursts: [[0, 0.4], [0.6, 0.4]], cycleS: 3 },
  us: { freqs: [440, 480], bursts: [[0, 2]], cycleS: 6 },
};

export function playRingback(accent: Accent, rings: number, volume: number): Ringback {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return { done: Promise.resolve(), stop() {} };

  const ctx = new AudioCtx();
  void ctx.resume();
  const p = PATTERNS[accent];
  const t0 = ctx.currentTime + 0.4; // a short beat of silence after pressing the button, as the call connects
  let endTime = t0;

  for (let r = 0; r < rings; r++) {
    for (const [start, len] of p.bursts) {
      const a = t0 + r * p.cycleS + start;
      const b = a + len;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, a);
      gain.gain.linearRampToValueAtTime(volume, a + 0.02);
      gain.gain.setValueAtTime(volume, b - 0.02);
      gain.gain.linearRampToValueAtTime(0, b);
      gain.connect(ctx.destination);
      for (const f of p.freqs) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start(a);
        osc.stop(b + 0.05);
      }
      endTime = Math.max(endTime, b);
    }
  }
  // After the last ring, a short pause is the "pick up" gap.
  const totalMs = (endTime - ctx.currentTime + 0.5) * 1000;

  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = () => {
      void ctx.close().catch(() => undefined);
      resolve();
    };
    setTimeout(finish, totalMs);
  });
  return { done, stop: finish };
}
