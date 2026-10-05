// The "pcm" speech format (ElevenLabs pcm_24000) is raw 16-bit signed little-endian mono samples at 24 kHz, with no header.
// Network chunks can split a 2-byte sample in half, so leftover bytes are carried into the next chunk.

export const PCM_SAMPLE_RATE = 24000;

export function decodePcm16(
  chunk: Uint8Array,
  carry: Uint8Array | null,
): { samples: Float32Array; carry: Uint8Array | null } {
  let bytes = chunk;
  if (carry && carry.length) {
    bytes = new Uint8Array(carry.length + chunk.length);
    bytes.set(carry, 0);
    bytes.set(chunk, carry.length);
  }
  const usable = bytes.length - (bytes.length % 2);
  const nextCarry = usable < bytes.length ? bytes.slice(usable) : null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  const samples = new Float32Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, carry: nextCarry };
}
