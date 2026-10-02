// Fixes words that speech recognition regularly mishears on sales calls (see config/speech_corrections.json).
// Pure and dependency-free, so it works on the server and in the browser and can be tested on its own.

export interface Correction {
  heard: string;
  said: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyCorrections(text: string, corrections: Correction[]): string {
  let out = text;
  for (const c of corrections) {
    if (!c.heard || c.heard.toLowerCase() === c.said.toLowerCase()) continue;
    // Whole words only, and tolerant of any spaces the recogniser puts inside the phrase.
    const pattern = c.heard.trim().split(/\s+/).map(escapeRegex).join("\\s+");
    const re = new RegExp(`(?<![\\w.])${pattern}(?![\\w])`, "gi");
    out = out.replace(re, (match) => {
      // Keep a capital letter if the recogniser started a sentence with the wrong word.
      const startsUpper = /^[A-Z]/.test(match) && /^[a-z]/.test(c.said);
      return startsUpper ? c.said[0].toUpperCase() + c.said.slice(1) : c.said;
    });
  }
  return out;
}
