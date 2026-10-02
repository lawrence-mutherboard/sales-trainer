// Run with: npm run test:metrics
import { computeCallMetrics, countFillers, countQuestions } from "../src/lib/scoring/callMetrics";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

const f = countFillers("So, um, we help teams, you know, get monday.com working. Erm, it's basically about adoption. I'd like to show you. Well, like, sort of.");
const names = Object.fromEntries(f.breakdown.map((b) => [b.word, b.count]));
assert(names["um"] === 1 && names["erm"] === 1, "um and erm are counted");
assert(names["you know"] === 1 && names["basically"] === 1, '"you know" and "basically" are counted');
assert(names["sort of / kind of"] === 1, '"sort of" is counted');
assert(names["so (to start a sentence)"] === 1, 'a sentence-opening "So" is counted');
assert(names["like"] === 1, '"like," set off by commas counts, but "I\'d like to show you" does not');
assert(countFillers("Please send over the documentation and the pricing.").total === 0, "a clean sentence has no fillers");
assert(countFillers("The summer sermon was herm-like").total === 0, "words that merely contain um/er are not counted");

assert(countQuestions("What tools do you use? And how does that work? Who signs it off?") === 3, "question marks are counted");
assert(countQuestions("What tools do you use at the moment. Tell me about the team. How does the process work today") === 2, "without question marks, question-shaped sentences are counted");

const turns = [
  { speaker: "prospect" as const, text: "Hello?", started_ms: 0, ended_ms: 1000 },
  { speaker: "rep" as const, text: Array.from({ length: 150 }, () => "word").join(" "), started_ms: 2000, ended_ms: 62000 },
  { speaker: "prospect" as const, text: "Go on then.", started_ms: 63000, ended_ms: 64000 },
  { speaker: "rep" as const, text: Array.from({ length: 30 }, () => "word").join(" ") + " ok?", started_ms: 65000, ended_ms: 80000 },
];
const m = computeCallMetrics(turns, "voice", 90000);
assert(m.timed && m.rep_words === 181, "word counts are right");
assert(m.wpm === Math.round(181 / (75000 / 60000)), `pace = words / minutes spoken (${m.wpm} wpm)`);
assert(m.longest_monologue_s === 60, "longest stretch is the longest rep turn (60 s)");
assert(m.call_seconds === 90 && m.questions === 1, "call length and questions");
const typed = computeCallMetrics(turns, "typed", 90000);
assert(!typed.timed && typed.wpm === null && typed.longest_monologue_s === null, "typed calls have no pace or monologue length");
