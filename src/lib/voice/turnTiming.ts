// Deciding when the rep has finished speaking. Waiting too long makes the prospect feel slow; too short cuts the
// rep off when they pause mid-thought. So the wait depends on how the sentence ended.

export interface TurnTimingConfig {
  /** Wait after the browser has settled on a phrase that doesn't clearly end or continue. */
  normalMs: number;
  /** Wait when the browser is still guessing at the last words. */
  guessingMs: number;
  /** Wait when it clearly sounds finished (a question mark or full stop). */
  finishedMs: number;
  /** Wait when it clearly stopped mid-sentence ("...and", "...the", "...so"). */
  unfinishedMs: number;
}

export const DEFAULT_TURN_TIMING: TurnTimingConfig = { normalMs: 800, guessingMs: 1400, finishedMs: 650, unfinishedMs: 1600 };

// Words that almost never end a sentence. If the rep stops on one, they are probably still thinking.
const CONTINUATION = new Set([
  "and", "but", "so", "because", "or", "if", "then", "also", "though", "although", "while", "since", "until",
  "the", "a", "an", "to", "of", "with", "for", "in", "on", "at", "as", "about", "into", "from", "by", "than",
  "my", "our", "your", "their", "its", "his", "her", "this", "these", "those", "some", "any", "very", "really",
  "is", "are", "was", "were", "be", "been", "have", "has", "had", "will", "would", "could", "should", "can", "do", "does",
  "um", "uh", "erm", "er", "hmm", "like", "which", "who", "whose", "that", "we", "i", "they",
]);

export function waitAfterPhraseMs(text: string, cfg: TurnTimingConfig = DEFAULT_TURN_TIMING): number {
  const trimmed = text.trim();
  if (!trimmed) return cfg.normalMs;
  if (/[?]["')\]]*$/.test(trimmed) || /[.!]["')\]]*$/.test(trimmed)) return cfg.finishedMs;
  if (/[,;:-]$/.test(trimmed)) return cfg.unfinishedMs;
  const last = trimmed.toLowerCase().replace(/[^a-z' ]/g, "").split(/\s+/).pop() ?? "";
  if (CONTINUATION.has(last)) return cfg.unfinishedMs;
  return cfg.normalMs;
}
