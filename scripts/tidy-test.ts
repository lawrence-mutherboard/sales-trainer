// Run with: npm run test:tidy
// Tries the after-call punctuation on a few unpunctuated lines, the way Chrome delivers them.
import Module from "node:module";
try { process.loadEnvFile(".env.local"); } catch { /* fine */ }
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const orig = M._load;
M._load = function (r: unknown, ...rest: unknown[]) { return r === "server-only" ? {} : orig.call(this, r, ...rest); };

const LINES = [
  "hi it's sam from mutherboard is now a bad time to talk",
  "you guys use monday today",
  "we help teams get monday.com set up properly so it actually gets used especially the crm side",
  "so that's your CRM right",
  "what does your current process look like for tracking deals in salesforce or hubspot",
];
(async () => {
  const { tidyLines } = await import("../src/lib/ai/tidyTranscript");
  const t0 = Date.now();
  const out = await tidyLines(LINES);
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)} s for ${LINES.length} lines\n`);
  LINES.forEach((l, i) => console.log(`in : ${l}\nout: ${out[i]}\n`));
})();
