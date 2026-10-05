// Chrome's speech recognition returns words with no punctuation or capitals. This adds them, so the transcript on
// screen, the AI prospect and the scorer all read something sensible (and "?" lets the question counter work).
// It is a light, rule-based guess, not a language model: the accurate transcription (when it is on) replaces it.

const QUESTION_STARTERS = new Set([
  "what", "how", "why", "when", "where", "who", "which", "whose",
  "can", "could", "would", "will", "do", "does", "did", "is", "are", "was", "were",
  "have", "has", "shall", "should", "may", "might", "isn't", "aren't", "don't", "doesn't",
  "won't", "wouldn't", "couldn't", "shouldn't", "haven't", "hasn't", "didn't", "wasn't",
]);

const ENDS_WITH_MARK = /[.?!…]["')\]]*$/;

function fixPronounI(text: string): string {
  return text.replace(/\bi\b(?=$|[\s,.?!']|'(?:m|ll|ve|d)\b)/g, "I");
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function looksLikeQuestion(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  if (QUESTION_STARTERS.has(words[0])) return true;
  // "So what ...", "And how ...", "Okay so do you ..."
  if (["so", "and", "but", "okay", "ok", "right", "well"].includes(words[0]) && QUESTION_STARTERS.has(words[1] ?? "")) return true;
  // tag questions: "..., right" / "..., isn't it"
  const joined = words.join(" ");
  if (/\b(?:right|isn't it|don't you|doesn't it|aren't you|yeah|correct)$/.test(joined)) return true;
  // statements said as questions: "you guys use monday today", "so that's your CRM"
  return (
    /^(?:so )?(?:you(?:'re| are| guys| folks| currently| still)?|your|that's|that is)\b/.test(joined) &&
    /\b(?:use|using|run|running|have|got|still|currently|today|crm)\b/.test(joined) &&
    words.length <= 12
  );
}

/**
 * The browser delivers a turn as several phrases, split where the rep paused. A pause inside a turn is usually a comma;
 * the end of the turn is a question mark or a full stop.
 */
export function punctuateTurn(pieces: string[]): string {
  const clean = pieces.map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) return "";

  const out = clean.map((piece, i) => {
    let t = fixPronounI(piece);
    const last = i === clean.length - 1;
    const startsSentence = i === 0 || ENDS_WITH_MARK.test(clean[i - 1]);
    if (startsSentence) t = sentenceCase(t);
    if (ENDS_WITH_MARK.test(t)) return t;
    if (!last) return `${t},`;
    return looksLikeQuestion(t) ? `${t}?` : `${t}.`;
  });

  // Several phrases make one question: "Is now a bad time, to talk" -> "Is now a bad time to talk?"
  const joined = out.join(" ");
  if (clean.length > 1 && /\?$/.test(joined) === false && looksLikeQuestion(clean.join(" ")) && /\.$/.test(joined)) {
    return joined.replace(/\.$/, "?");
  }
  return joined;
}
