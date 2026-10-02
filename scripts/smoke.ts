// Run with: npm run smoke
// Offline check (no API calls): generates a prospect + prompts for every settings combination and
// looks for unfilled {placeholders} or "undefined" text.
import Module from "node:module";

const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

async function main() {
  const { config, SIZES, DEPARTMENTS, DIFFICULTIES, PERSONALITIES } = await import("../src/lib/config/index");
  const { generateProspect } = await import("../src/lib/profile/generate");
  const { buildGlobalPrompt, buildSessionPrompt, buildClockNote } = await import("../src/lib/ai/prospectPrompt");

  // Mood tags like {impatient} are intentional in the prompt. Anything else in curly braces is a broken placeholder.
  const moodTags = new RegExp(`\\{(mood|${Object.keys(config.ai.tts.moods).join("|")})\\}`, "g");
  const clean = (s: string) => s.replace(moodTags, "");
  const bad = /\{[a-z_]+\}|undefined|NaN|\[object/;
  let count = 0;
  const problems: string[] = [];

  const globalPrompt = buildGlobalPrompt();
  if (bad.test(clean(globalPrompt))) problems.push("global prompt has a bad token");

  for (const scenario of Object.keys(config.scenarios)) {
    for (const size of SIZES) for (const dept of DEPARTMENTS) for (const diff of DIFFICULTIES) for (const pers of PERSONALITIES) {
      const p = generateProspect({ companySize: size, department: dept, difficulty: diff, scenario });
      const session = {
        id: "x", rep_id: "y", company_size: size, department: dept, personality: pers, scenario, difficulty: diff,
        prospect_name: p.name, prospect_title: p.title, prospect_company: p.company, input_mode: "voice" as const,
        status: "ready" as const, ended_by: null, duration_ms: null, started_at: "", ended_at: null,
      };
      const text = buildSessionPrompt(session, p.secrets);
      count++;
      const m = bad.exec(clean(text));
      if (m) problems.push(`${scenario}/${size}/${dept}/${diff}/${pers}: "${m[0]}"`);
      const { min, max } = config.personas.difficulties[diff].objections;
      const n = p.secrets.objection_ids.length;
      if (n < 1 || n > Math.max(max, 1)) problems.push(`objection count ${n} outside ${min}-${max} for ${diff}`);
    }
  }

  const sample = generateProspect({ companySize: "enterprise", department: "finance", difficulty: "hard", scenario: "discovery" });
  console.log(`Checked ${count} combinations. Problems: ${problems.length}`);
  problems.slice(0, 10).forEach((p) => console.log(" -", p));
  console.log("\nSample prospect:", sample.name, "|", sample.title, "|", sample.company);
  console.log("Objections:", sample.secrets.objection_ids.join(", "));
  console.log("Cost of pain:", sample.secrets.profile.cost_of_pain);
  console.log("Clock note:", buildClockNote({ elapsedMs: 100_000, limitMs: 300_000, lastRepTurnMs: 95_000, prospectName: sample.name }));
  console.log(`Global prompt length: ${globalPrompt.length} chars`);
  if (problems.length) process.exit(1);
}
main();
