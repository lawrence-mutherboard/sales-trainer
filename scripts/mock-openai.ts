// Run with: npm run test:openai-mock
// Offline test of the OpenAI provider against a fake local server (no API key, no cost).
// Checks that streaming replies, the hang-up marker, and JSON scoring are parsed and assembled correctly.
import http from "node:http";
import Module from "node:module";
import type { AddressInfo } from "node:net";

const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

const SCORE_JSON = {
  criteria: [{ id: "core_opener", grade: "full", quote: "Hi, it's Sam from mutherboard", turn: 2, tip: "Keep doing that." }],
  accuracy_errors: [{ quote: "Standard is $30", turn: 4, issue: "Standard is $12 billed annually." }],
  success_condition_met: true,
  success_evidence: "Meeting booked for Thursday at 10.",
  top_improvements: [{ title: "Ask about cost", moment_quote: "ok", turn: 3, example_line: "What does that cost you each week?" }],
  key_moments: [{ turn: 2, kind: "strength", label: "Clear opener" }],
  profile_findings: [{ key: "current_tools", uncovered: true, evidence: "We use spreadsheets" }],
  summary: "Good start. Dig deeper on cost.",
};

function startMock(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      if (process.env.SHOW_SIZES) console.log(`[mock] stream=${Boolean(json.stream)} request_chars=${body.length} (~${Math.round(body.length / 4)} tokens)`);
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      if (json.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const pieces = ["Hello, ", "who's this? ", "I'm quite busy. ", "[[END_", "CALL]]"];
        for (const p of pieces) {
          res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 1200, completion_tokens: 12, total_tokens: 1212, prompt_tokens_details: { cached_tokens: 1024 } } })}\n\n`);
        res.end("data: [DONE]\n\n");
      } else {
        // Scoring request: must ask for strict JSON schema output.
        const ok = json.response_format?.type === "json_schema" && json.response_format?.json_schema?.strict === true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "x",
            object: "chat.completion",
            model: json.model,
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: ok ? JSON.stringify(SCORE_JSON) : "NOT STRICT" } }],
          }),
        );
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

async function main() {
  const server = await startMock();
  const port = (server.address() as AddressInfo).port;
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

  const { getProvider } = await import("../src/lib/ai/provider");
  const { scoreSession } = await import("../src/lib/ai/scorer");
  const { generateProspect } = await import("../src/lib/profile/generate");

  const provider = getProvider();
  assert(provider.name === "openai", "LLM_PROVIDER=openai selects the OpenAI provider");

  // 1) Streaming prospect reply
  let text = "";
  const r = await provider.streamProspect({
    globalPrompt: "G",
    sessionPrompt: "S",
    messages: [{ role: "user", content: "[The call connects.]" }],
    privateNote: "[Call clock: 00:00 of 05:00.]",
    onText: (d) => (text += d),
  });
  assert(text === "Hello, who's this? I'm quite busy. [[END_CALL]]", "streamed text arrives in full");
  assert(r.refused === false, "not marked as refused");

  // 2) Full scoring pipeline
  const p = generateProspect({ companySize: "smb", department: "sales", difficulty: "easy", scenario: "cold_call" });
  const session = {
    id: "x", rep_id: "y", company_size: "smb", department: "sales", personality: "friendly", scenario: "cold_call", difficulty: "easy",
    prospect_name: p.name, prospect_title: p.title, prospect_company: p.company, input_mode: "voice" as const,
    status: "ended" as const, ended_by: "prospect" as const, duration_ms: 60000, started_at: "", ended_at: null,
  };
  const turns = [
    { id: "1", session_id: "x", idx: 0, speaker: "prospect" as const, text: "Hello?", started_ms: 0, ended_ms: 1000 },
    { id: "2", session_id: "x", idx: 1, speaker: "rep" as const, text: "Hi, it's Sam from mutherboard", started_ms: 1500, ended_ms: 9000 },
    { id: "3", session_id: "x", idx: 2, speaker: "prospect" as const, text: "We use spreadsheets", started_ms: 9500, ended_ms: 12000 },
  ];
  const { result, model } = await scoreSession({ session, turns, secrets: p.secrets });

  assert(model === "gpt-4.1", "scorer model recorded");
  assert(result.pass === true, "pass comes from the success condition");
  const opener = result.criteria.find((c) => c.id === "core_opener");
  assert(opener?.points === 10 && opener.grade === "full", "full grade -> full points (10)");
  const listening = result.criteria.find((c) => c.id === "core_listening");
  assert(listening?.points === 0, "criteria the scorer skipped score zero");
  const acc = result.sections.find((s) => s.key === "accuracy");
  assert(acc?.points === 5, "one accuracy error costs 5 points");
  assert(result.total === 15, `total = 10 (opener) + 0 + 5 (accuracy) = 15, got ${result.total}`);
  assert(result.profile_uncovered.some((f) => f.key === "current_tools"), "uncovered profile field reported");
  assert(result.profile_missed.length === 8, "the other 8 profile fields reported as missed");

  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
