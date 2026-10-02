// Run with: npm run test:role
// Checks that the AI prospect stays in the CUSTOMER role. It sends ~20 tricky things a rep might say
// (the kind that made an earlier version flip into acting like the salesperson) and flags any reply that
// sounds like a salesperson, or that is missing the {mood} tag.
//
// This calls the real AI provider (LLM_PROVIDER from .env.local) about 20 times with short prompts,
// which costs a few cents. Re-run it whenever you change the model, the prompt or roleplay_examples.json.
import Module from "node:module";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine if missing; the keys may already be in the environment */
}

const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

const REP_LINES = [
  "Hi, can I introduce myself?",
  "Hello, is that Sarah? It's Sam calling from mutherboard.",
  "Have you got a minute?",
  "Can I tell you a bit about what we do?",
  "How are you today?",
  "What do you think about monday.com?",
  "So what's your biggest challenge at the moment?",
  "We help companies set up monday.com properly, so it actually gets used.",
  "Sorry, could you repeat that?",
  "Shall we book a meeting for Thursday?",
  "Would you be open to a quick demo?",
  "I'll send you an email with a bit more detail.",
  "Are you the right person to speak to about project tools?",
  "Thanks for your time. Is there anything else I can help you with?",
  "What would you like to know about us?",
  "Hello?",
  "Um, sorry, I've lost my train of thought for a second.",
  "Tell me a bit about your team.",
  "Our rate is a hundred and sixty pounds an hour.",
  "Okay great, so what happens next?",
];

// Phrases that only a salesperson would say. (A customer saying "Mutherboard? Never heard of it" is fine.)
const SALESPERSON_FLAGS: RegExp[] = [
  /\bhow can I (help|assist) you\b/i,
  /\bwhat can I (help|do for) you with\b/i,
  /\b(we|I) (can|could|will) (help|offer|provide|set up|support|show) you\b/i,
  /\bour (team|services|platform|solution|experts|offering)\b/i,
  /\b(at|from) mutherboard,? (we|I)\b/i,
  /\bI'?d (love|be happy|be glad|be delighted) to (show|help|walk|tell|explain)\b/i,
  /\blet me (tell|explain|show|walk) you\b/i,
  /\b(shall|can|could) (we|I) (book|schedule|arrange|set up) (a|some|the)\b.*\b(call|meeting|demo|time)\b/i,
  /\bwhat are your biggest (challenges|pain points)\b/i,
  /\bthanks? for (calling|reaching out|your time)\b.*\bhow can\b/i,
];

async function main() {
  const { config } = await import("../src/lib/config/index");
  const { getProvider } = await import("../src/lib/ai/provider");
  const { generateProspect } = await import("../src/lib/profile/generate");
  const { buildClockNote, buildGlobalPrompt, buildSessionPrompt } = await import("../src/lib/ai/prospectPrompt");

  const provider = getProvider();
  const p = generateProspect({ companySize: "smb", department: "sales", difficulty: "medium", scenario: "cold_call" });
  const session = {
    id: "x", rep_id: "y", company_size: "smb", department: "sales", personality: "skeptical", scenario: "cold_call", difficulty: "medium",
    prospect_name: p.name, prospect_title: p.title, prospect_company: p.company, input_mode: "voice" as const,
    status: "in_progress" as const, ended_by: null, duration_ms: null, started_at: "", ended_at: null,
  };
  const globalPrompt = buildGlobalPrompt();
  const sessionPrompt = buildSessionPrompt(session, p.secrets);
  const note = buildClockNote({ elapsedMs: 20_000, limitMs: 300_000, lastRepTurnMs: null, prospectName: p.name });

  console.log(`Provider: ${provider.name} | prospect: ${p.name}, ${p.title} at ${p.company} | ${REP_LINES.length} rep lines\n`);

  const results: { rep: string; reply: string; mood: string | null; flags: string[] }[] = [];
  const queue = [...REP_LINES];
  const workers = Array.from({ length: 4 }, async () => {
    for (let rep = queue.shift(); rep; rep = queue.shift()) {
      let text = "";
      await provider.streamProspect({
        globalPrompt,
        sessionPrompt,
        messages: [
          { role: "user", content: "[The call connects. Nobody has spoken yet.]" },
          { role: "assistant", content: "{neutral} Hello?" },
          { role: "user", content: rep },
        ],
        privateNote: note,
        onText: (d) => (text += d),
      });
      const m = /^\s*\{([a-z]+)\}\s*/i.exec(text);
      const mood = m ? m[1].toLowerCase() : null;
      const reply = text.replace(/^\s*\{[^}]*\}\s*/, "").replace("[[END_CALL]]", "").trim();
      const flags = SALESPERSON_FLAGS.filter((re) => re.test(reply)).map((re) => re.source);
      if (!mood) flags.push("missing {mood} tag");
      else if (!config.ai.tts.moods[mood]) flags.push(`unknown mood "${mood}"`);
      results.push({ rep, reply, mood, flags });
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => REP_LINES.indexOf(a.rep) - REP_LINES.indexOf(b.rep));
  for (const r of results) {
    console.log(`${r.flags.length ? "FLAG" : "ok  "}  Rep: "${r.rep}"\n      Customer: {${r.mood ?? "?"}} ${r.reply}`);
    for (const f of r.flags) console.log(`      -> ${f}`);
  }
  const bad = results.filter((r) => r.flags.length).length;
  console.log(`\n${results.length - bad}/${results.length} replies looked right.${bad ? ` ${bad} flagged: read them above.` : ""}`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
