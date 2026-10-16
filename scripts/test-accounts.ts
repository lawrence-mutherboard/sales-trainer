// Test accounts for trying the Team and Admin pages, with made-up practice history.
//
//   npm run test-accounts -- add       creates 5 test accounts (and their fake calls and scores)
//   npm run test-accounts -- remove    deletes every test account and everything that belongs to them
//
// Every test account's email starts with "trainer-test-" (for example trainer-test-alex@mutherboard.com). The script
// only ever creates or deletes accounts whose email starts with that, so it can't touch a real person. The accounts are
// created already confirmed (no emails are sent). "add" prints one password you can use to sign in as any of them, for
// example to check what happens when an admin turns their access off.
//
// Note: sign-in accounts live in the Supabase project's shared sign-in list (Authentication -> Users), so the test
// accounts appear there until you run "remove".
import { createClient } from "@supabase/supabase-js";
import Module from "node:module";
import { randomBytes, randomUUID } from "node:crypto";

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

const PREFIX = "trainer-test-";

interface Plan {
  key: string;
  name: string;
  calls: number;
  /** Score of the oldest call and of the newest one (they move in a line between, plus some noise). */
  from: number;
  to: number;
  /** How many days ago the newest call was. */
  newestDaysAgo: number;
  scenarios: string[];
}

const PLANS: Plan[] = [
  { key: "alex", name: "Alex Turner (test)", calls: 8, from: 35, to: 72, newestDaysAgo: 1, scenarios: ["cold_call", "cold_call", "discovery"] },
  { key: "priya", name: "Priya Shah (test)", calls: 6, from: 70, to: 84, newestDaysAgo: 2, scenarios: ["discovery", "demo", "objection_handling"] },
  { key: "morgan", name: "Morgan Lee (test)", calls: 5, from: 62, to: 38, newestDaysAgo: 4, scenarios: ["cold_call", "objection_handling"] },
  { key: "sam", name: "Sam Okafor (test)", calls: 3, from: 45, to: 50, newestDaysAgo: 15, scenarios: ["cold_call"] },
  { key: "jordan", name: "Jordan Reid (test)", calls: 0, from: 0, to: 0, newestDaysAgo: 0, scenarios: [] },
];

const REP_LINES = [
  "Hi, it's calling from mutherboard. I know I'm calling out of the blue, have you got thirty seconds?",
  "We help operations teams get monday.com set up so status updates stop living in email.",
  "How are you tracking projects across the team at the moment?",
  "What does that cost you each week, roughly?",
  "Would it be worth twenty minutes on Thursday at ten to look at it properly?",
];
const PROSPECT_LINES = ["Hello?", "Go on then, briefly.", "Mostly spreadsheets, if I'm honest.", "A few hours a week, probably.", "Thursday at ten works."];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

async function main() {
  const command = process.argv[2];
  if (command !== "add" && command !== "remove") {
    console.log("Usage: npm run test-accounts -- add    |    npm run test-accounts -- remove");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { config } = await import("../src/lib/config/index");
  const { TABLES } = await import("../src/lib/db/tables");
  const { allowedDomain } = await import("../src/lib/authDomain");
  const { generateProspect } = await import("../src/lib/profile/generate");
  const { PROFILE_FIELDS } = await import("../src/lib/types");
  const domain = allowedDomain();
  const emailFor = (k: string) => `${PREFIX}${k}@${domain}`;

  // All sign-in accounts whose email starts with the test prefix (the list is read page by page).
  async function testUsers() {
    const found: { id: string; email: string }[] = [];
    for (let page = 1; page < 100; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      for (const u of data.users) {
        const e = (u.email ?? "").toLowerCase();
        if (e.startsWith(PREFIX) && e.endsWith(`@${domain}`)) found.push({ id: u.id, email: e });
      }
      if (data.users.length < 1000) break;
    }
    return found;
  }

  if (command === "remove") {
    const users = await testUsers();
    if (users.length === 0) {
      console.log("No test accounts found. Nothing to remove.");
      return;
    }
    for (const u of users) {
      // Deleting the sign-in account removes their trainer profile, calls, transcripts and scores with it.
      const { error } = await db.auth.admin.deleteUser(u.id);
      console.log(error ? `FAILED to delete ${u.email}: ${error.message}` : `deleted ${u.email} and all their test data`);
    }
    return;
  }

  // ---------------------------------------------------------------- add
  const existing = new Map((await testUsers()).map((u) => [u.email, u.id]));
  if (existing.size > 0) {
    console.log(`Test accounts already exist (${[...existing.keys()].join(", ")}). Run "remove" first to start fresh.`);
    return;
  }
  const password = `Test-${randomBytes(6).toString("hex")}A1`;

  for (const plan of PLANS) {
    const email = emailFor(plan.key);
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: plan.name },
    });
    if (error || !created.user) throw new Error(`Couldn't create ${email}: ${error?.message}`);
    const userId = created.user.id;

    const { error: profErr } = await db.from(TABLES.profiles).insert({ id: userId, email, name: plan.name, role: "rep" });
    if (profErr) throw new Error(`Couldn't create the trainer profile for ${email}: ${profErr.message}`);

    for (let i = 0; i < plan.calls; i++) {
      // Oldest first; spread over about a month, ending plan.newestDaysAgo days ago.
      const progress = plan.calls === 1 ? 1 : i / (plan.calls - 1);
      const daysAgo = plan.newestDaysAgo + (plan.calls - 1 - i) * rand(2, 4);
      const startedAt = new Date(Date.now() - daysAgo * 86_400_000 - rand(0, 8) * 3_600_000);
      const target = Math.max(5, Math.min(95, plan.from + (plan.to - plan.from) * progress + rand(-6, 6)));
      const scenarioKey = pick(plan.scenarios);
      const scenario = config.scenarios[scenarioKey];
      const size = pick(["smb", "mid_market", "enterprise"] as const);
      const dept = pick(["sales", "operations", "product", "finance"] as const);
      const personality = pick(["friendly", "uninterested", "skeptical"] as const);
      const difficulty = pick(["easy", "medium", "hard"] as const);
      const prospect = generateProspect({ companySize: size, department: dept, difficulty, scenario: scenarioKey });
      const durationMs = Math.round(rand(2.5, scenario.time_limit_min) * 60_000);
      const sessionId = randomUUID();

      const { error: sErr } = await db.from(TABLES.sessions).insert({
        id: sessionId,
        rep_id: userId,
        company_size: size,
        department: dept,
        personality,
        scenario: scenarioKey,
        difficulty,
        prospect_name: prospect.name,
        prospect_title: prospect.title,
        prospect_company: prospect.company,
        input_mode: "voice",
        status: "scored",
        ended_by: "rep",
        duration_ms: durationMs,
        started_at: startedAt.toISOString(),
        ended_at: new Date(startedAt.getTime() + durationMs).toISOString(),
      });
      if (sErr) throw new Error(`Couldn't create a test call: ${sErr.message}`);
      await db.from(TABLES.secrets).insert({ session_id: sessionId, hidden_profile: prospect.secrets });

      // A short transcript.
      const turns = PROSPECT_LINES.flatMap((p, n) => [
        { speaker: "prospect", text: p },
        ...(n < REP_LINES.length ? [{ speaker: "rep", text: REP_LINES[n] }] : []),
      ]).map((t, idx) => ({ session_id: sessionId, idx, speaker: t.speaker, text: t.text, started_ms: idx * 12_000, ended_ms: idx * 12_000 + 9_000 }));
      await db.from(TABLES.turns).insert(turns);

      // A score that looks like the real thing: a grade per criterion, close to the target total.
      const grade = () => {
        const r = Math.random() * 100;
        return r < target - 15 ? "full" : r < target + 20 ? "partial" : "zero";
      };
      const points = (max: number, g: string) => Math.floor(max * (g === "full" ? 1 : g === "partial" ? 0.5 : 0));
      const mod = config.rubric.modules[scenario.module];
      const criteria = [
        ...config.rubric.core.criteria.map((c) => ({ ...c, section: "core" as const })),
        ...mod.criteria.map((c) => ({ ...c, section: "module" as const })),
      ].map((c, n) => {
        const g = grade();
        return {
          id: c.id,
          name: c.name,
          section: c.section,
          points: points(c.max, g),
          max: c.max,
          grade: g,
          quote: g === "zero" ? "" : REP_LINES[n % REP_LINES.length],
          turn: g === "zero" ? 0 : 2 + 2 * (n % REP_LINES.length),
          tip: c.full,
          improve: g === "full" ? "Keep doing this." : `Next time: ${c.full}`,
        };
      });
      const core = criteria.filter((c) => c.section === "core");
      const module_ = criteria.filter((c) => c.section === "module");
      const sum = (xs: { points: number }[]) => xs.reduce((n, c) => n + c.points, 0);
      const accuracy = config.rubric.accuracy.max;
      const total = sum(core) + sum(module_) + accuracy;
      const repShare = rand(0.38, 0.72);
      const repWords = Math.round(rand(120, 320));
      const fillerCount = Math.round((repWords * rand(0.5, 7)) / 100);
      const weakest = [...criteria].sort((a, b) => a.points / a.max - b.points / b.max).slice(0, 3);
      const uncovered = new Set(PROFILE_FIELDS.filter(() => Math.random() < target / 120).map((f) => f.key));

      const result = {
        total,
        pass: total >= 65,
        success_condition: scenario.success_condition,
        success_evidence: total >= 65 ? "Test data: a next step was agreed." : "Test data: no next step was agreed.",
        sections: [
          { key: "core", label: config.rubric.core.label, points: sum(core), max: core.reduce((n, c) => n + c.max, 0) },
          { key: "module", label: mod.label, points: sum(module_), max: module_.reduce((n, c) => n + c.max, 0) },
          { key: "accuracy", label: config.rubric.accuracy.label, points: accuracy, max: accuracy },
        ],
        criteria,
        accuracy_errors: [],
        top_improvements: weakest.map((c) => ({ title: c.name, moment_quote: REP_LINES[2], turn: 6, example_line: c.tip })),
        key_moments: [
          { turn: 2, kind: "strength", label: "Clear opener" },
          { turn: 6, kind: "miss", label: "Missed follow-up" },
          { turn: 10, kind: total >= 65 ? "strength" : "miss", label: "The ask" },
        ],
        profile_uncovered: PROFILE_FIELDS.filter((f) => uncovered.has(f.key)).map((f) => ({ key: f.key, label: f.label, truth: prospect.secrets.profile[f.key], uncovered: true, evidence: "Test data." })),
        profile_missed: PROFILE_FIELDS.filter((f) => !uncovered.has(f.key)).map((f) => ({ key: f.key, label: f.label, truth: prospect.secrets.profile[f.key], uncovered: false, evidence: "" })),
        summary: "This is made-up test data for trying the Team and Admin pages. It is not a real call.",
        strengths: ["Test data: kept the opener short.", "Test data: asked about the current process."],
        metrics: {
          timed: true,
          rep_words: repWords,
          prospect_words: Math.round(repWords * rand(0.6, 1.4)),
          wpm: Math.round(rand(118, 178)),
          filler_count: fillerCount,
          filler_pct: Math.round((fillerCount / repWords) * 1000) / 10,
          fillers: fillerCount ? [{ word: "um", count: Math.ceil(fillerCount / 2) }, { word: "you know", count: Math.floor(fillerCount / 2) }] : [],
          longest_monologue_s: Math.round(rand(18, 85)),
          questions: Math.round(rand(1, 6)),
          call_seconds: Math.round(durationMs / 1000),
        },
        talk: { available: true, rep_ms: Math.round(durationMs * repShare), prospect_ms: Math.round(durationMs * (1 - repShare)), rep_share: repShare, limit: 0.6, over_limit: repShare > 0.6 },
        scenario_label: scenario.label,
      };
      const { error: scErr } = await db.from(TABLES.scores).insert({ session_id: sessionId, total, pass: result.pass, result_json: result, model: "test-data" });
      if (scErr) throw new Error(`Couldn't save a test score: ${scErr.message}`);
    }
    console.log(`created ${email} with ${plan.calls} test call${plan.calls === 1 ? "" : "s"}`);
  }

  console.log(`\nPassword for every test account: ${password}`);
  console.log("Remove them all when you're done with:  npm run test-accounts -- remove");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
