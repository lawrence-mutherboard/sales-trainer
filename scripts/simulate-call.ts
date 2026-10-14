// Run with: npm run simulate -- [scenario] [rep] [count]
//   scenario: cold_call | discovery | demo | objection_handling   (default cold_call)
//   rep:      good | poor | average                              (default good)
//   count:    how many calls to simulate                          (default 1)
// Plays whole practice calls with no microphone: a second Claude plays the sales rep (well or badly), against the real AI
// prospect (same prompts, same model as the app). Prints each transcript so you can judge how realistic the prospect is.
// Uses your Anthropic key; a few cents per call.
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

const REP_STYLES: Record<string, string> = {
  good:
    "You are a GOOD rep. Short, natural sentences. Earn permission to continue, lead with something relevant to the prospect's department (not a product pitch), ask open questions and follow up on the answers, handle brush-offs calmly, and make a clear ask with a specific day and time. Never ramble.",
  average:
    "You are an AVERAGE rep. You mean well but sometimes pitch features before understanding the prospect, ask the odd closed question, and suggest 'a quick catch-up sometime' instead of a specific time. You do listen a bit.",
  poor:
    "You are a POOR rep. You open with 'How are you today?', talk about mutherboard and its services at length before asking anything, ignore what the prospect says, push for a meeting repeatedly, and use generic claims like 'we save you time and money'.",
};

async function main() {
  const scenarioKey = process.argv[2] ?? "cold_call";
  const repStyle = process.argv[3] ?? "good";
  const count = Number(process.argv[4] ?? 1);

  const { config } = await import("../src/lib/config/index");
  const { anthropic } = await import("../src/lib/ai/client");
  const { getProvider } = await import("../src/lib/ai/provider");
  const { generateProspect } = await import("../src/lib/profile/generate");
  const { buildClockNote, buildGlobalPrompt, buildSessionPrompt, repNotesFor } = await import("../src/lib/ai/prospectPrompt");

  const scenario = config.scenarios[scenarioKey];
  if (!scenario) throw new Error(`Unknown scenario ${scenarioKey}`);
  const sizes = ["smb", "mid_market", "enterprise"] as const;
  const depts = ["sales", "operations", "product", "finance"] as const;
  const personalities = ["friendly", "uninterested", "skeptical"] as const;

  for (let n = 0; n < count; n++) {
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    const dept = depts[Math.floor(Math.random() * depts.length)];
    const personality = personalities[Math.floor(Math.random() * personalities.length)];
    const p = generateProspect({ companySize: size, department: dept, difficulty: "medium", scenario: scenarioKey });
    const session = {
      id: `sim-${Date.now()}-${n}`, rep_id: "sim", company_size: size, department: dept, personality, scenario: scenarioKey,
      difficulty: "medium", prospect_name: p.name, prospect_title: p.title, prospect_company: p.company, input_mode: "voice" as const,
      status: "in_progress" as const, ended_by: null, duration_ms: null, started_at: new Date().toISOString(), ended_at: null,
    };
    const notes = repNotesFor ? repNotesFor(session, p.secrets) : null;
    console.log(`\n==================== ${scenario.label} | rep: ${repStyle} | ${p.name}, ${p.title} at ${p.company} (${size}, ${dept}, ${personality})`);
    if (notes) console.log(`Rep's notes: ${notes.join(" | ")}`);

    const repSystem = `You are role-playing a sales rep from mutherboard, a monday.com partner, on a ${scenario.label} with ${p.name} (${p.title} at ${p.company}). Brief: ${scenario.rep_brief}${notes ? ` Your notes from earlier: ${notes.join("; ")}.` : ""}
${REP_STYLES[repStyle] ?? REP_STYLES.good}
Reply with ONLY the next thing you say out loud on the phone, one to three sentences. If the prospect says goodbye or the call is clearly over, reply with exactly: [END]`;

    const prospectMsgs: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: "[The call connects. Nobody has spoken yet.]" }];
    const repMsgs: { role: "user" | "assistant"; content: string }[] = [];
    let elapsed = 0;
    let lastRepMs: number | null = null;
    const limit = scenario.time_limit_min * 60_000;

    for (let turn = 0; turn < 14; turn++) {
      let text = "";
      await getProvider().streamProspect({
        globalPrompt: buildGlobalPrompt(),
        sessionPrompt: buildSessionPrompt(session, p.secrets),
        messages: prospectMsgs,
        privateNote: buildClockNote({ elapsedMs: elapsed, limitMs: limit, lastRepTurnMs: lastRepMs, prospectName: p.name }),
        onText: (d) => (text += d),
      });
      const mood = /^\s*\{([a-z]+)\}/i.exec(text)?.[1] ?? "-";
      const ended = text.includes("[[END_CALL]]");
      const spoken = text.replace(/^\s*\{[^}]*\}\s*/, "").replace("[[END_CALL]]", "").trim();
      console.log(`PROSPECT {${mood}}: ${spoken}`);
      prospectMsgs.push({ role: "assistant", content: text });
      elapsed += Math.max(2000, spoken.split(/\s+/).length * 400);
      if (ended) {
        console.log("(prospect ended the call)");
        break;
      }

      repMsgs.push({ role: "user", content: spoken });
      let repText = "";
      for (let attempt = 0; attempt < 3 && !repText; attempt++) {
        const rep = await anthropic().messages.create({ model: "claude-sonnet-5-5", max_tokens: 2000, system: repSystem, messages: repMsgs });
        repText = rep.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      }
      if (!repText) throw new Error("the simulated rep gave no reply");
      if (repText.includes("[END]")) {
        console.log("(rep ended the call)");
        break;
      }
      console.log(`REP: ${repText}`);
      repMsgs.push({ role: "assistant", content: repText });
      prospectMsgs.push({ role: "user", content: repText });
      lastRepMs = repText.split(/\s+/).length * 400;
      elapsed += lastRepMs + 800;
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
