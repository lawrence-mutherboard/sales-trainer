// Run with: npm run test:audio
// Checks the WAV encoder, silence trimming, and the "is this transcript believable" guard.
import { encodeWav16, plausibleTranscript, trimSilence } from "../src/lib/voice/audio";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

const RATE = 16000;

// WAV header
const wav = encodeWav16(new Float32Array([0, 0.5, -0.5, 1, -1]), RATE);
const dv = new DataView(wav.buffer);
const tag = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
assert(tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && tag(36) === "data", "WAV has the RIFF/WAVE/fmt/data markers");
assert(dv.getUint32(24, true) === RATE && dv.getUint16(22, true) === 1 && dv.getUint16(34, true) === 16, "WAV is 16 kHz, mono, 16-bit");
assert(dv.getUint32(40, true) === 10 && wav.length === 54, "WAV data length matches the samples");
assert(dv.getInt16(46, true) === Math.round(0.5 * 0x7fff) || Math.abs(dv.getInt16(46, true) - 16383) <= 1, "sample values are scaled correctly");

// Silence / speech / silence
function tone(seconds: number, amp: number) {
  const n = Math.round(seconds * RATE);
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / RATE) + (Math.random() - 0.5) * 0.002);
}
const quiet = (s: number) => Float32Array.from({ length: Math.round(s * RATE) }, () => (Math.random() - 0.5) * 0.004);
const signal = Float32Array.from([...quiet(2), ...tone(1.5, 0.3), ...quiet(3)]);
const range = trimSilence(signal, RATE);
assert(range !== null, "speech is found inside silence");
if (range) {
  const startS = range.start / RATE;
  const endS = range.end / RATE;
  assert(startS > 1.5 && startS < 2.0, `trim starts just before the speech (${startS.toFixed(2)}s, speech starts at 2.0s)`);
  assert(endS > 3.5 && endS < 4.2, `trim ends just after the speech (${endS.toFixed(2)}s, speech ends at 3.5s)`);
}
assert(trimSilence(quiet(3), RATE) === null, "pure silence gives no speech (so nothing is sent for transcription)");
assert(trimSilence(Float32Array.from([...quiet(1), ...tone(0.04, 0.3), ...quiet(1)]), RATE) === null, "a tiny click is not treated as speech");

// Transcript guard
assert(plausibleTranscript("Is now a bad time to talk?", "Is now a bed time to talk?"), "a close transcript is accepted");
assert(!plausibleTranscript("Thank you for watching, please subscribe to our channel and like the video everyone", "Hi"), "invented text is rejected");
assert(!plausibleTranscript("Hi", "so we help teams get monday.com working properly in a few weeks"), "a transcript that lost most of the speech is rejected");
assert(!plausibleTranscript("", "hello there"), "an empty transcript is rejected");

// Noise floor: follows the room, not the speech.
import { speechThreshold, updateNoiseFloor } from "../src/lib/voice/audio";
let floor = 0.005;
for (let i = 0; i < 600; i++) floor = updateNoiseFloor(floor, 0.004); // quiet room for a minute
assert(floor <= 0.005 && speechThreshold(floor) === 0.015, "quiet room: threshold stays at the minimum (0.015)");
for (let i = 0; i < 300; i++) floor = updateNoiseFloor(floor, 0.3); // 30 s of loud talking
assert(floor < 0.15, "a long stretch of loud speech does not instantly become the 'background'");
let noisy = 0.005;
for (let i = 0; i < 5000; i++) noisy = updateNoiseFloor(noisy, 0.03); // a noisy room, a long time
assert(speechThreshold(noisy) > 0.05, "a noisy room raises the speech threshold");
