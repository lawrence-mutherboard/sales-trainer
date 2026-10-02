import type { CallMetrics, TurnRow } from "@/lib/types";

// Speaking metrics computed in code from the transcript and timestamps, never judged by the AI.
// Speaking time comes from the turn timestamps, so pace and monologue length are estimates (they include the
// short pause the app waits at the end of each turn). Typed calls have no speaking time, so those are null.

// Fillers. "um/uh" style hesitations, a few phrases, and the sentence-opening "so" (Gong finds it is the most
// common filler). Plain "like" is only counted when it is set off by commas, because "I'd like to" is not a filler.
const HESITATIONS = /\b(?:u+m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+)\b/gi;
const PHRASES: [string, RegExp][] = [
  ["you know", /\byou know\b/gi],
  ["I mean", /\bi mean\b/gi],
  ["sort of / kind of", /\b(?:sort|kind) of\b/gi],
  ["basically", /\bbasically\b/gi],
  ["literally", /\bliterally\b/gi],
  ["actually", /\bactually\b/gi],
  ["like", /(?:,\s*like\b|\blike\s*,)/gi],
  ["so (to start a sentence)", /(?:^|[.?!]\s+)so\b/gi],
];

export function countFillers(text: string): { total: number; breakdown: { word: string; count: number }[] } {
  const counts = new Map<string, number>();
  const add = (word: string, n: number) => n > 0 && counts.set(word, (counts.get(word) ?? 0) + n);

  const hes = text.match(HESITATIONS) ?? [];
  for (const h of hes) {
    const w = h.toLowerCase();
    const label = /^u+m+$/.test(w) ? "um" : /^u+h+$/.test(w) ? "uh" : /^e+r/.test(w) ? "erm" : /^a+h+$/.test(w) ? "ah" : "hmm";
    add(label, 1);
  }
  for (const [label, re] of PHRASES) add(label, (text.match(re) ?? []).length);

  const breakdown = [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
  return { total: breakdown.reduce((n, b) => n + b.count, 0), breakdown };
}

const QUESTION_STARTERS = /^(?:what|how|why|when|where|who|which|whose|can|could|would|will|do|does|did|is|are|were|was|have|has|shall|should)\b/i;

/** Counts questions. Uses question marks when the transcript has them, and otherwise sentences that open like a question. */
export function countQuestions(text: string): number {
  const marks = (text.match(/\?/g) ?? []).length;
  if (marks > 0) return marks;
  return text
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter((s) => QUESTION_STARTERS.test(s) && s.split(/\s+/).length >= 4).length;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function computeCallMetrics(
  turns: Pick<TurnRow, "speaker" | "text" | "started_ms" | "ended_ms">[],
  inputMode: "voice" | "typed",
  durationMs: number | null,
): CallMetrics {
  const rep = turns.filter((t) => t.speaker === "rep");
  const prospect = turns.filter((t) => t.speaker === "prospect");
  const repText = rep.map((t) => t.text).join(" ");

  const repWords = countWords(repText);
  const prospectWords = countWords(prospect.map((t) => t.text).join(" "));

  let speakingMs = 0;
  let longestMs = 0;
  for (const t of rep) {
    if (t.started_ms == null || t.ended_ms == null) continue;
    const d = Math.max(0, t.ended_ms - t.started_ms);
    speakingMs += d;
    longestMs = Math.max(longestMs, d);
  }
  const timed = inputMode === "voice" && speakingMs > 5000; // under 5 seconds of speech is too little to measure pace

  const fillers = countFillers(repText);
  return {
    timed,
    rep_words: repWords,
    prospect_words: prospectWords,
    wpm: timed ? Math.round(repWords / (speakingMs / 60000)) : null,
    filler_count: fillers.total,
    filler_pct: repWords ? Math.round((fillers.total / repWords) * 1000) / 10 : 0,
    fillers: fillers.breakdown,
    longest_monologue_s: timed ? Math.round(longestMs / 1000) : null,
    questions: countQuestions(repText),
    call_seconds: durationMs != null ? Math.round(durationMs / 1000) : null,
  };
}
