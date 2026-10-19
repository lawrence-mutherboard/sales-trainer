// Spots a "transcript of the rep" that is really the prospect's own words: picked up from the speakers, or copied by the
// transcription model from its context. Pure, so it can be tested on its own.

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when `heard` is mostly the same words as one of the prospect's recent lines. Needs at least 5 words, so a rep
 * who repeats a short phrase back ("you're in the middle of something?") is never thrown away.
 */
export function echoesProspect(heard: string, prospectLines: string[], threshold = 0.75): boolean {
  const h = words(heard);
  if (h.length < 5) return false;
  for (const line of prospectLines) {
    const p = words(line);
    if (p.length < 5) continue;
    const inLine = new Set(p);
    const shared = h.filter((w) => inLine.has(w)).length;
    // Share of the heard words that come from the prospect's line, and lengths alike (so a long answer that quotes a
    // few of their words is not an echo).
    if (shared / h.length >= threshold && Math.min(h.length, p.length) / Math.max(h.length, p.length) >= 0.6) return true;
  }
  return false;
}
