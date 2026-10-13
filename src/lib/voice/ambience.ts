// A faint office "room tone" played during the call, so the line is not unnaturally silent between the prospect's words.
// It is soft, low-pitched noise made with the Web Audio API (no audio file). Keep the volume low: with speakers the
// microphone could hear it, which is why the app only plays it when the rep wears headphones (config/call.json).

export interface Ambience {
  stop(): void;
}

export function startAmbience(volume: number): Ambience {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return { stop() {} };

  const ctx = new AudioCtx();
  void ctx.resume();

  // Four seconds of brown noise (deep, soft hiss), looped.
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  // Cross-fade the loop point so there is no click.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = data[i] * t + data[length - fade + i] * (1 - t);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.5);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();

  return {
    stop() {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        setTimeout(() => void ctx.close().catch(() => undefined), 400);
      } catch {
        /* already closed */
      }
    },
  };
}
