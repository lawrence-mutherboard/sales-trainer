// Run with: npm run test:turn
// Checks the end-of-turn waits and the accent mix.
import { DEFAULT_TURN_TIMING as T, waitAfterPhraseMs } from "../src/lib/voice/turnTiming";
import { pickAccent } from "../src/lib/voice/accent";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

assert(waitAfterPhraseMs("Is now a bad time to talk?") === T.finishedMs, "a question ends the turn quickly");
assert(waitAfterPhraseMs("That makes sense.") === T.finishedMs, "a full stop ends the turn quickly");
assert(waitAfterPhraseMs("so what we usually find is that teams struggle with and") === T.unfinishedMs, 'stopping on "and" waits longer');
assert(waitAfterPhraseMs("we help companies with the") === T.unfinishedMs, 'stopping on "the" waits longer');
assert(waitAfterPhraseMs("well, ") === T.unfinishedMs, "stopping after a comma waits longer");
assert(waitAfterPhraseMs("erm") === T.unfinishedMs, 'a filler word ("erm") waits longer');
assert(waitAfterPhraseMs("what does your current process look like for tracking deals") === T.normalMs, "an ordinary ending uses the normal wait");
assert(waitAfterPhraseMs("") === T.normalMs, "empty text uses the normal wait");
assert(T.finishedMs < T.normalMs && T.normalMs < T.unfinishedMs, "waits are ordered: finished < normal < unfinished");

// Accent mix: roughly 80% UK over many different names, and the same name always gets the same accent.
const first = ["Sarah", "James", "Priya", "Tom", "Aisha", "Daniel", "Emma", "Marcus", "Hannah", "Callum", "Olivia", "Rahul"];
const last = ["Whitaker", "Patel", "Okafor", "Bennett", "Hughes", "Sinclair", "Nguyen", "Morgan", "Ahmed", "Fletcher", "Brennan", "Clarke", "Hussain", "Rowe", "Thompson", "Adeyemi"];
let uk = 0;
let total = 0;
for (const f of first) for (const l of last) for (const c of ["Bright", "Harbour", "Summit", "Kestrel", "Lumen"]) {
  total++;
  if (pickAccent(`${f} ${l} ${c}`, 80) === "uk") uk++;
}
const pct = (uk / total) * 100;
assert(pct > 72 && pct < 88, `about 80% of ${total} prospects are British (got ${pct.toFixed(1)}%)`);
assert(pickAccent("Sarah Patel", 80) === pickAccent("Sarah Patel", 80), "the same prospect always gets the same accent");
assert(pickAccent("Anyone", 100) === "uk" && pickAccent("Anyone", 0) === "us", "0% and 100% behave as expected");
