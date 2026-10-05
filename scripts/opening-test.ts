// Run with: npm run test:opening
// Checks the prospect's FIRST line on a call. In a cold call or a discovery call it should be a plain
// "Hello?" / "Hi there?", with no name, job title, company, or "who is this?".
// Calls the real AI provider ~16 times with short prompts (a few cents).
import Module from "node:module";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine if missing */
}
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

const PER_SCENARIO = 8;

async function main() {
  const { config } = await import("../src/lib/config/index");
  const { getProvider } = await import("../src/lib/ai/provider");
  const { generateProspect } = await import("../src/lib/profile/generate");
  const { buildClockNote, buildGlobalPrompt, buildSessionPrompt } = await import("../src/lib/ai/prospectPrompt");
  const provider = getProvider();
  const globalPrompt = buildGlobalPrompt();

  const jobs: { scenario: string; n: number }[] = [];
  for (const scenario of ["cold_call", "discovery"]) for (let n = 0; n < PER_SCENARIO; n++) jobs.push({ scenario, n });

  const rows: { scenario: string; reply: string; problems: string[] }[] = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const sizes = ["smb", "mid_market", "enterprise"] as const;
        const depts = ["sales", "operations", "product", "finance"] as const;
        const p = generateProspect({ companySize: sizes[job.n % 3], department: depts[job.n % 4], difficulty: "medium", scenario: job.scenario });
        const session = {
          id: "x", rep_id: "y", company_size: sizes[job.n % 3], department: depts[job.n % 4], personality: "friendly", scenario: job.scenario,
          difficulty: "medium", prospect_name: p.name, prospect_title: p.title, prospect_company: p.company, input_mode: "voice" as const,
          status: "ready" as const, ended_by: null, duration_ms: null, started_at: "", ended_at: null,
        };
        let text = "";
        await provider.streamProspect({
          globalPrompt,
          sessionPrompt: buildSessionPrompt(session, p.secrets),
          messages: [{ role: "user", content: "[The call connects. Nobody has spoken yet.]" }],
          privateNote: buildClockNote({ elapsedMs: 0, limitMs: 300_000, lastRepTurnMs: null, prospectName: p.name }),
          onText: (d) => (text += d),
        });
        const reply = text.replace(/^\s*\{[^}]*\}\s*/, "").replace("[[END_CALL]]", "").trim();
        const problems: string[] = [];
        if (reply.split(/\s+/).length > 5) problems.push("longer than a plain greeting");
        const lower = reply.toLowerCase();
        if (lower.includes(p.name.split(" ")[0].toLowerCase())) problems.push("says its name");
        if (lower.includes(p.company.split(" ")[0].toLowerCase())) problems.push("says its company");
        if (/speaking|who('| i)?s (this|calling)|who is this|how can i help/.test(lower)) problems.push("asks who it is / answers like a receptionist");
        if (!config.ai.tts.moods[(/^\s*\{([a-z]+)\}/i.exec(text)?.[1] ?? "").toLowerCase()]) problems.push("missing {mood} tag");
        rows.push({ scenario: job.scenario, reply, problems });
      }
    }),
  );

  rows.sort((a, b) => a.scenario.localeCompare(b.scenario));
  for (const r of rows) console.log(`${r.problems.length ? "FLAG" : "ok  "}  [${r.scenario}] "${r.reply}"${r.problems.length ? `  -> ${r.problems.join("; ")}` : ""}`);
  const bad = rows.filter((r) => r.problems.length).length;
  console.log(`\n${rows.length - bad}/${rows.length} openings were a plain greeting.`);
  if (bad) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
