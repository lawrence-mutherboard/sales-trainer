import "server-only";
import { config } from "@/lib/config";
import { anthropic } from "./client";

// Chrome's speech recognition gives words with no punctuation. This asks a small, fast Claude model to add punctuation,
// capitals and question marks, and nothing else. We check that the words are unchanged and, if they are not, keep the original.

const SYSTEM = `You add punctuation to speech-to-text output from a sales call. For each numbered line, return the same words with correct capitalisation, commas, full stops and question marks.
Rules:
- Do NOT add, remove, reorder or correct any words. Only punctuation, capitalisation and spacing may change.
- Use "?" for anything that is a question, even when it does not start with a question word ("you guys use monday today?", "so that's your CRM, right?").
- Keep every filler word (um, uh, erm, ah, like, you know) exactly where it is, written as "um," "uh," and so on. Never remove them.
- Keep product names as they are (monday.com, Salesforce, HubSpot, mutherboard).
Reply with ONLY a JSON array of strings, one per input line, in the same order.`;

const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean).join(" ");

export async function tidyLines(lines: string[]): Promise<string[]> {
  if (!config.ai.tidy.enabled || lines.length === 0) return lines;
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  try {
    const msg = await anthropic().messages.create({
      model: config.ai.tidy.model,
      max_tokens: Math.min(8000, 200 + lines.join(" ").length),
      system: SYSTEM,
      messages: [{ role: "user", content: numbered }],
    });
    const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)) as unknown;
    if (!Array.isArray(arr) || arr.length !== lines.length) return lines;
    return lines.map((orig, i) => {
      const t = arr[i];
      return typeof t === "string" && t.trim() && wordsOf(t) === wordsOf(orig) ? t.trim() : orig;
    });
  } catch (err) {
    console.error("[tidy] failed, keeping the original text", err);
    return lines;
  }
}
