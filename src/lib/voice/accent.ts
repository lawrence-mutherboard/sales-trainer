// Which accent a prospect speaks with. Chosen from the prospect's name, so it is random across prospects
// (roughly `ukPercent` % British, the rest American) but the same for the whole of one call.

export type Accent = "uk" | "us";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function pickAccent(seed: string, ukPercent: number): Accent {
  // A different salt from the voice choice, so accent and voice are not tied together.
  return hash(`accent:${seed}`) % 100 < ukPercent ? "uk" : "us";
}
