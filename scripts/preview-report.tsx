// Run with: npm run preview:report
// Draws the report page from made-up data into preview/report.html so you can look at the layout without making a
// call. Needs `npx next build` to have been run once (it borrows the built stylesheet). Costs nothing.
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";

const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: unknown, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};

type Grade = "full" | "partial" | "zero";

function criterion(
  id: string,
  name: string,
  section: "core" | "module",
  max: number,
  grade: Grade,
  quote: string,
  turn: number,
  tip: string,
  improve: string,
) {
  const points = grade === "full" ? max : grade === "partial" ? Math.floor(max / 2) : 0;
  return { id, name, section, max, grade, points, quote, turn, tip, improve };
}

async function main() {
  const { ReportView } = await import("../src/app/report/[id]/ReportView");

  const criteria = [
    criterion("core_opener", "Clear opener", "core", 10, "partial", "Hi, it's Sam from mutherboard", 2, "Name yourself and mutherboard, give one specific reason for the call, and propose the agenda.", "You gave your name but not why you were calling. Add one sentence: 'I'm calling because teams like yours often lose hours a week to status reporting.'"),
    criterion("core_listening", "Listening", "core", 10, "partial", "Right, and how many people are on the team?", 8, "Builds on what the prospect just said and never talks over them.", "Your follow-ups were good, but one answer got no follow-up at all. When the prospect mentions a cost, ask 'what does that add up to?'"),
    criterion("core_next_steps", "Next steps", "core", 10, "zero", "", 0, "States the next step, agrees a date and time, and names who else should be involved.", "The call ended without a next step. Before hanging up, say: 'Can we book twenty minutes on Thursday at 10 with your ops lead?'"),
    criterion("cc_permission", "Earns permission to continue", "module", 10, "full", "I know I'm calling out of the blue", 2, "Owns the interruption and asks for a short window.", "Keep this. To go from good to excellent, tie the reason for the call to their department straight away."),
    criterion("cc_insight", "Leads with an insight", "module", 15, "partial", "We help teams get monday.com working", 4, "Opens with a specific observation about teams like theirs and what it costs.", "You described what mutherboard does. Lead with what you see in teams like theirs first, then connect it to your service."),
    criterion("cc_brushoff", "Handles the brush-off", "module", 15, "full", "Totally fair, can I ask one quick question?", 6, "Acknowledges the brush-off and asks a small, relevant question.", "Nothing major. You stayed calm and asked a good question."),
    criterion("cc_qualify", "Asks qualifying questions", "module", 10, "partial", "What do you use today?", 6, "Asks two or three relevant questions and uses the answers.", "You asked one qualifying question. Add one about who is involved in the decision."),
    criterion("cc_ask", "Direct ask for the meeting", "module", 10, "zero", "", 0, "Asks directly for a meeting and proposes specific times.", "You never asked for the meeting. Finish with: 'Would Tuesday at 2 or Thursday at 10 work for a short call?'"),
  ];

  const result = {
    strengths: ["Stayed calm and polite when the prospect brushed you off.", "Asked a relevant question about their current tools.", "Kept your answers short and clear."],
    metrics: {
      timed: true, rep_words: 412, prospect_words: 188, wpm: 163, filler_count: 14, filler_pct: 3.4,
      fillers: [{ word: "um", count: 6 }, { word: "so (to start a sentence)", count: 4 }, { word: "you know", count: 2 }, { word: "basically", count: 2 }],
      longest_monologue_s: 48, questions: 3, call_seconds: 214,
    },
    total: 54,
    pass: false,
    success_condition: "A meeting is booked with a specific date and time.",
    success_evidence: "The call ended without a date or time being agreed.",
    sections: [
      { key: "core", label: "Core", points: 10, max: 30 },
      { key: "module", label: "Cold call", points: 38, max: 60 },
      { key: "accuracy", label: "Accuracy", points: 5, max: 10 },
    ],
    criteria,
    accuracy_errors: [{ quote: "Standard is about thirty dollars a seat", turn: 14, issue: "Standard is $12 per seat per month billed annually ($14 monthly)." }],
    top_improvements: [
      { title: "Ask for the meeting with specific times", moment_quote: "So yeah, I'll let you go", turn: 6, example_line: "Would Tuesday at 2 or Thursday at 10 work for a twenty-minute call?" },
      { title: "Lead with an insight, not a description", moment_quote: "We help teams get monday.com working", turn: 4, example_line: "Teams like yours usually lose five to eight hours a week to status reporting. Is that familiar?" },
      { title: "Say why you are calling in your opener", moment_quote: "Hi, it's Sam from mutherboard", turn: 2, example_line: "I'm calling because your team's reporting is probably still in spreadsheets. Have you got a minute?" },
    ],
    key_moments: [{ turn: 2, kind: "strength", label: "Owned the call" }, { turn: 6, kind: "miss", label: "No ask" }],
    profile_uncovered: [{ key: "current_tools", label: "Current tools", truth: "Spreadsheets and a shared inbox", uncovered: true, evidence: "We use spreadsheets" }],
    profile_missed: [
      { key: "real_pain", label: "Real pain", truth: "Pipeline lives in spreadsheets, so no forecast.", uncovered: false, evidence: "" },
      { key: "decision_maker", label: "Decision maker", truth: "The Managing Director signs off.", uncovered: false, evidence: "" },
    ],
    summary: "Calm and polite, with a decent opener, but you never asked for the meeting and didn't lead with a reason they would care about.",
    talk: { available: true, rep_ms: 130000, prospect_ms: 84000, rep_share: 0.607, limit: 0.6, over_limit: true },
    scenario_label: "Cold call",
  };

  const session = {
    id: "demo", rep_id: "r", company_size: "smb", department: "sales", personality: "skeptical", scenario: "cold_call", difficulty: "medium",
    prospect_name: "Priya Doyle", prospect_title: "Head of Sales", prospect_company: "Tidewater Consulting", input_mode: "voice" as const,
    status: "scored" as const, ended_by: "rep" as const, duration_ms: 214000, started_at: new Date().toISOString(), ended_at: null,
  };

  const lines: [string, string][] = [
    ["prospect", "Hello?"],
    ["rep", "Hi, it's Sam from mutherboard. I know I'm calling out of the blue."],
    ["prospect", "Who?"],
    ["rep", "We help teams get monday.com working, so it actually gets used."],
    ["prospect", "We're fine, thanks."],
    ["rep", "Totally fair, can I ask one quick question? What do you use today?"],
    ["prospect", "Spreadsheets, mostly."],
  ];
  const turns = lines.map(([speaker, text], i) => ({
    id: String(i), session_id: "demo", idx: i, speaker: speaker as "rep" | "prospect", text, started_ms: i * 9000, ended_ms: i * 9000 + 4000,
  }));

  const previous = {
    ...result,
    sections: [
      { key: "core", label: "Core", points: 14, max: 30 },
      { key: "module", label: "Cold call", points: 30, max: 60 },
      { key: "accuracy", label: "Accuracy", points: 10, max: 10 },
    ],
  };

  const html = renderToStaticMarkup(
    <ReportView
      result={result as never}
      session={session}
      turns={turns}
      prev={previous as never}
      footer={<button className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white">Retry this scenario</button>}
    />,
  );

  const cssDir = path.join(process.cwd(), ".next", "static", "chunks");
  const cssFile = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).find((f) => f.endsWith(".css")) : undefined;
  if (!cssFile) throw new Error("No built stylesheet found. Run `npx next build` first.");
  const outDir = path.join(process.cwd(), "preview");
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(cssDir, cssFile), path.join(outDir, "style.css"));
  fs.writeFileSync(
    path.join(outDir, "report.html"),
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><title>Report preview</title></head><body class="min-h-screen bg-slate-50 antialiased"><main class="mx-auto w-full max-w-5xl px-4 py-8">${html}</main></body></html>`,
  );
  console.log("Wrote preview/report.html");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
