// Run with: npm run test:pcm
// Checks the audio decoder used for the streaming voice, including chunks that split a 2-byte sample in half.
import { decodePcm16 } from "../src/lib/voice/pcm";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

// Samples: 0, 16384 (0.5), -32768 (-1.0), 32767 (~1.0), -16384 (-0.5), 1
const source = new Int16Array([0, 16384, -32768, 32767, -16384, 1]);
const bytes = new Uint8Array(source.buffer.slice(0));

const whole = decodePcm16(bytes, null);
assert(whole.samples.length === 6 && whole.carry === null, "whole clip decodes to 6 samples");
assert(whole.samples[1] === 0.5 && whole.samples[2] === -1 && whole.samples[4] === -0.5, "values are scaled to -1..1");

// Split at every possible byte boundary, including mid-sample: the result must be identical.
for (let cut = 1; cut < bytes.length; cut++) {
  const a = decodePcm16(bytes.slice(0, cut), null);
  const b = decodePcm16(bytes.slice(cut), a.carry);
  const joined = [...a.samples, ...b.samples];
  const same = joined.length === 6 && joined.every((v, i) => v === whole.samples[i]) && b.carry === null;
  if (!same) assert(false, `split at byte ${cut} gives the same samples`);
}
assert(true, "every split point gives the same samples");
