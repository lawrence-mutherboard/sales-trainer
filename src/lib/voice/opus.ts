// Compresses a clip of speech to Opus (in an Ogg file) before it is uploaded for transcription.
// Uncompressed speech is about 32 KB per second, and on a normal home connection the upload, not the transcription, is what takes
// the time. Opus at 24 kbit/s is about 3 KB per second, roughly ten times smaller. It uses the browser's own encoder (WebCodecs)
// and wraps the packets in an Ogg container by hand. If the browser can't do this, the caller sends the uncompressed WAV instead.

const BITRATE = 24_000;
const PRE_SKIP = 312; // samples (at 48 kHz) the decoder drops at the start; the usual figure for Opus encoders

interface AudioEncoderLike {
  configure(config: unknown): void;
  encode(data: unknown): void;
  flush(): Promise<void>;
  close(): void;
}
interface EncodedChunkLike {
  byteLength: number;
  duration: number | null;
  copyTo(dest: Uint8Array): void;
}
type WithWebCodecs = {
  AudioEncoder?: {
    new (init: { output: (chunk: EncodedChunkLike) => void; error: (e: unknown) => void }): AudioEncoderLike;
    isConfigSupported(config: unknown): Promise<{ supported?: boolean }>;
  };
  AudioData?: new (init: { format: string; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }) => unknown;
};

function config(sampleRate: number) {
  return { codec: "opus", sampleRate, numberOfChannels: 1, bitrate: BITRATE, opus: { application: "voip", frameDuration: 20_000 } };
}

/** True if this browser can encode Opus. */
export async function opusSupported(sampleRate: number): Promise<boolean> {
  const w = globalThis as unknown as WithWebCodecs;
  if (typeof w.AudioEncoder?.isConfigSupported !== "function" || typeof w.AudioData !== "function") return false;
  try {
    return Boolean((await w.AudioEncoder.isConfigSupported(config(sampleRate))).supported);
  } catch {
    return false;
  }
}

// ---- Ogg container ------------------------------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      crcTable[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** One Ogg page holding whole packets. */
function oggPage(packets: Uint8Array[], opts: { flags: number; granule: number; serial: number; sequence: number }): Uint8Array {
  const lacing: number[] = [];
  let dataLen = 0;
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
    dataLen += p.length;
  }
  const header = 27 + lacing.length;
  const page = new Uint8Array(header + dataLen);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0; // version
  page[5] = opts.flags;
  view.setUint32(6, opts.granule >>> 0, true); // granule position, low 32 bits (clips are far shorter than 2^32 samples)
  view.setUint32(10, 0, true);
  view.setUint32(14, opts.serial, true);
  view.setUint32(18, opts.sequence, true);
  view.setUint32(22, 0, true); // checksum, filled in below
  page[26] = lacing.length;
  page.set(lacing, 27);
  let o = header;
  for (const p of packets) {
    page.set(p, o);
    o += p.length;
  }
  view.setUint32(22, crc32(page), true);
  return page;
}

function textBytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** Pieces of Ogg-Opus: the two header packets, then one page per batch of audio packets. */
function buildOgg(packets: { data: Uint8Array; samples48k: number }[], inputRate: number): Uint8Array {
  const serial = Math.floor(Math.random() * 0xffffffff) >>> 0;

  const head = new Uint8Array(19);
  head.set(textBytes("OpusHead"), 0);
  head[8] = 1; // version
  head[9] = 1; // channels
  new DataView(head.buffer).setUint16(10, PRE_SKIP, true);
  new DataView(head.buffer).setUint32(12, inputRate, true);
  new DataView(head.buffer).setUint16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family

  const vendor = textBytes("mutherboard");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(textBytes("OpusTags"), 0);
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  new DataView(tags.buffer).setUint32(12 + vendor.length, 0, true); // no user comments

  const pages: Uint8Array[] = [];
  let seq = 0;
  pages.push(oggPage([head], { flags: 0x02, granule: 0, serial, sequence: seq++ })); // beginning of stream
  pages.push(oggPage([tags], { flags: 0, granule: 0, serial, sequence: seq++ }));

  let granule = PRE_SKIP;
  let batch: Uint8Array[] = [];
  let lacingCount = 0;
  const flush = (last: boolean) => {
    if (batch.length === 0 && !last) return;
    pages.push(oggPage(batch, { flags: last ? 0x04 : 0, granule, serial, sequence: seq++ }));
    batch = [];
    lacingCount = 0;
  };
  packets.forEach((p, i) => {
    const need = Math.floor(p.data.length / 255) + 1;
    if (lacingCount + need > 250) flush(false);
    batch.push(p.data);
    lacingCount += need;
    granule += p.samples48k;
    if (i === packets.length - 1) flush(true);
  });

  let total = 0;
  for (const p of pages) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of pages) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Encodes mono samples (-1..1) as Ogg Opus. Returns null if the browser can't, so the caller can send WAV instead. */
export async function encodeOggOpus(samples: Float32Array, sampleRate: number): Promise<Uint8Array | null> {
  if (samples.length === 0 || !(await opusSupported(sampleRate))) return null;
  const w = globalThis as unknown as WithWebCodecs;
  const packets: { data: Uint8Array; samples48k: number }[] = [];
  let failed = false;
  const encoder = new w.AudioEncoder!({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, samples48k: Math.round(((chunk.duration ?? 20_000) / 1_000_000) * 48_000) });
    },
    error: () => {
      failed = true;
    },
  });
  try {
    encoder.configure(config(sampleRate));
    encoder.encode(new w.AudioData!({ format: "f32", sampleRate, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: 0, data: samples }));
    await encoder.flush();
  } catch {
    return null;
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
  }
  if (failed || packets.length === 0) return null;
  return buildOgg(packets, sampleRate);
}
