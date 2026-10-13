// Run with: npm run test:latency
// Times the two server-side steps that make the prospect "slow to answer", with your real keys:
//   1. Claude: time until the first words, and until the first full sentence (what the voice needs to start).
//   2. ElevenLabs: time until the first audio arrives for a short sentence.
// It compares the model currently set in config/ai.json with Claude Haiku 4.5 (no thinking), over a few turns of a cold call.
// Costs a few cents.
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

const REP_LINES = [
  "Hi, it's Sam from mutherboard. Is now a bad time to talk?",
  "We help teams get monday.com set up properly so it actually gets used, especially the CRM side.",
  "So what does your current process look like for tracking deals?",
];

async function main() {
  const { config } = await import("../src/lib/config/index");
  const { anthropic } = await import("../src/lib/ai/client");
  const { generateProspect } = await import("../src/lib/profile/generate");
  const { buildClockNote, buildGlobalPrompt, buildSessionPrompt } = await import("../src/lib/ai/prospectPrompt");
  const { pickElevenVoice, streamElevenLabsSpeech } = await import("../src/lib/ai/elevenlabs");

  const p = generateProspect({ companySize: "smb", department: "operations", difficulty: "medium", scenario: "cold_call" });
  const session = {
    id: "latency-test", rep_id: "y", company_size: "smb", department: "operations", personality: "friendly", scenario: "cold_call",
    difficulty: "medium", prospect_name: p.name, prospect_title: p.title, prospect_company: p.company, input_mode: "voice" as const,
    status: "ready" as const, ended_by: null, duration_ms: null, started_at: "", ended_at: null,
  };
  const globalPrompt = buildGlobalPrompt();
  const sessionPrompt = buildSessionPrompt(session, p.secrets);

  const variants = [
    { label: `${config.ai.prospect.model} (thinking: ${config.ai.prospect.thinking})`, model: config.ai.prospect.model, thinking: config.ai.prospect.thinking === "between_tools" },
    { label: "claude-haiku-4-5 (no thinking)", model: "claude-haiku-4-5-20251001", thinking: false },
  ];

  for (const v of variants) {
    console.log(`\n== ${v.label}`);
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: "[The call connects. Nobody has spoken yet.]" }];
    let turn = 0;
    for (let i = 0; i <= REP_LINES.length; i++) {
      const started = Date.now();
      let firstText: number | null = null;
      let firstSentence: number | null = null;
      let text = "";
      const params = {
        model: v.model,
        max_tokens: config.ai.prospect.max_tokens,
        system: [
          { type: "text", text: globalPrompt, cache_control: { type: "ephemeral" } },
          { type: "text", text: sessionPrompt, cache_control: { type: "ephemeral" } },
        ],
        messages: [
          ...messages.slice(0, -1),
          { role: messages[messages.length - 1].role, content: [{ type: "text", text: messages[messages.length - 1].content }, { type: "text", text: buildClockNote({ elapsedMs: 10_000 * i, limitMs: 300_000, lastRepTurnMs: null, prospectName: p.name }) }] },
        ],
        ...(v.thinking ? { thinking: { type: "between_tools" } } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = anthropic().beta.messages.stream(params as any);
      stream.on("text", (d: string) => {
        firstText ??= Date.now() - started;
        text += d;
        if (firstSentence === null && /[.!?]["')\]]*\s/.test(text.replace(/^\s*\{[^}]*\}\s*/, "") + " ")) firstSentence = Date.now() - started;
      });
      await stream.finalMessage();
      turn++;
      const clean = text.replace(/^\s*\{[^}]*\}\s*/, "").trim();
      console.log(`turn ${turn}: first words ${firstText} ms, first sentence ${firstSentence ?? "-"} ms, total ${Date.now() - started} ms  "${clean.slice(0, 70)}"`);
      messages.push({ role: "assistant", content: text });
      if (i < REP_LINES.length) messages.push({ role: "user", content: REP_LINES[i] });
    }
  }

  console.log("\n== ElevenLabs first audio (same voice, short sentence)");
  const voiceId = await pickElevenVoice(p.name, false, "uk");
  for (let n = 1; n <= 3; n++) {
    const t0 = Date.now();
    const res = await streamElevenLabsSpeech({ text: "Yeah, go on then, what's this about?", voiceId });
    const reader = res.body!.getReader();
    await reader.read();
    console.log(`request ${n}: first audio ${Date.now() - t0} ms${n === 1 ? " (includes first connection)" : ""}`);
    await reader.cancel();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
