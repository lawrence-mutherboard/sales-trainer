import "server-only";
import { z } from "zod";
import { config, getScenario } from "@/lib/config";
import { getProvider, RefusalError } from "@/lib/ai/provider";
import { computeTalkStats } from "@/lib/scoring/talkRatio";
import { computeCallMetrics } from "@/lib/scoring/callMetrics";
import {
  PROFILE_FIELDS,
  type CriterionResult,
  type Grade,
  type ProfileFinding,
  type ScoreResult,
  type SectionResult,
  type SessionRow,
  type SessionSecrets,
  type TurnRow,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// What the model returns. Points are NOT taken from the model: it returns a grade per criterion
// and this file converts grades to points using config/rubric.json. Total and pass/fail are
// also computed here.
// ---------------------------------------------------------------------------

const profileKeys = PROFILE_FIELDS.map((f) => f.key) as [string, ...string[]];

const ModelOutput = z.object({
  criteria: z.array(
    z.object({
      id: z.string(),
      grade: z.enum(["full", "partial", "zero"]),
      quote: z.string(),
      turn: z.number(),
      tip: z.string(),
      improve: z.string().default(""),
    }),
  ),
  strengths: z.array(z.string()).default([]),
  accuracy_errors: z.array(z.object({ quote: z.string(), turn: z.number(), issue: z.string() })),
  success_condition_met: z.boolean(),
  success_evidence: z.string(),
  top_improvements: z.array(
    z.object({ title: z.string(), moment_quote: z.string(), turn: z.number(), example_line: z.string() }),
  ),
  key_moments: z.array(z.object({ turn: z.number(), kind: z.enum(["strength", "miss"]), label: z.string() })),
  profile_findings: z.array(z.object({ key: z.enum(profileKeys), uncovered: z.boolean(), evidence: z.string() })),
  summary: z.string(),
});

const str = { type: "string" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const OUTPUT_JSON_SCHEMA = obj({
  criteria: {
    type: "array",
    items: obj({ id: str, grade: { type: "string", enum: ["full", "partial", "zero"] }, quote: str, turn: int, tip: str, improve: str }),
  },
  accuracy_errors: { type: "array", items: obj({ quote: str, turn: int, issue: str }) },
  success_condition_met: bool,
  success_evidence: str,
  top_improvements: { type: "array", items: obj({ title: str, moment_quote: str, turn: int, example_line: str }) },
  key_moments: {
    type: "array",
    items: obj({ turn: int, kind: { type: "string", enum: ["strength", "miss"] }, label: str }),
  },
  profile_findings: {
    type: "array",
    items: obj({ key: { type: "string", enum: [...profileKeys] }, uncovered: bool, evidence: str }),
  },
  strengths: { type: "array", items: str },
  summary: str,
});

// ---------------------------------------------------------------------------

function mmss(ms: number | null): string {
  if (ms == null) return "--:--";
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function transcriptText(turns: TurnRow[]): string {
  return turns
    .map((t) => `[${t.idx + 1}] ${t.speaker === "rep" ? "REP" : "PROSPECT"} (${mmss(t.started_ms)}): ${t.text}`)
    .join("\n");
}

function pointsFor(max: number, grade: Grade): number {
  const g = config.rubric.grade_points[grade];
  return Math.floor(max * g);
}

const SYSTEM_PROMPT = `You are an experienced, fair and exacting B2B sales coach scoring a practice call between a mutherboard sales rep and an AI-played prospect.

Grading rules:
- Score ONLY the rep's words. Nothing the prospect says earns the rep points, except as evidence of what the rep achieved (for example the prospect agreed to a meeting).
- Every criterion is a specific, checkable question. Give a grade: "full" (clearly met), "partial" (attempted or met in part), or "zero" (not done). Do not give full credit for effort, tone or intent alone. Do not invent generosity.
- Quote the transcript line that justifies each grade: copy a short verbatim excerpt from the REP's line (under 25 words). For "zero", quote the closest relevant rep line, or use an empty string if the rep said nothing relevant. Put the transcript turn number (the number in square brackets) in "turn", or 0 if there is no quote.
- "tip" is ONE sentence saying what a full-marks answer would have sounded like in THIS call, specific to this prospect.
- "improve" is the room for improvement on that criterion: one or two sentences naming the specific thing the rep should do differently next time, tied to what they actually said. Never leave it generic. If the grade is "full", say what going from good to excellent would add; if there is truly nothing, say what to keep doing.
- "strengths": two or three short, specific things the rep did well in this call (each under 20 words), tied to the transcript.
- The transcript comes from speech recognition, so it has little punctuation and may contain mis-heard words. Do not penalise for that.
- Do not judge talk ratio. It is computed separately.
- Accuracy: list each clearly wrong monday.com or mutherboard price or fact, and each promise of a service mutherboard does not offer, using only the business facts supplied. If the rep is vague, hedges, or says they will check, that is not an error.
- Success condition: decide whether the scenario's success condition was met, judged from what was actually agreed in the transcript. It must match the condition's specifics (for example a booked meeting needs a specific date and time).
- Top improvements: exactly 3, ranked by how many points they would have won. Each has a short title, the rep's line at that moment, and an "example_line" the rep could have said instead (natural spoken British English, one or two sentences).
- Key moments: 4 to 8 turns worth marking in the replay, each labelled "strength" or "miss" with a very short label.
- Profile findings: for EACH of the profile fields, say whether the prospect actually revealed that fact during the call ("uncovered": true) or never did (false). Evidence is a short verbatim prospect quote if uncovered, or an empty string if not.
- Summary: two sentences of overall coaching.
Return ONLY the JSON that matches the schema.`;

export interface ScoreInput {
  session: SessionRow;
  turns: TurnRow[];
  secrets: SessionSecrets;
}

export async function scoreSession({ session, turns, secrets }: ScoreInput): Promise<{ result: ScoreResult; model: string }> {
  const scenario = getScenario(session.scenario);
  if (!scenario) throw new Error(`Unknown scenario ${session.scenario}`);
  const mod = config.rubric.modules[scenario.module];
  const { core, accuracy } = config.rubric;

  const listening = core.criteria.find((c) => c.id === "core_listening");
  const limit = listening?.talk_ratio_max_by_scenario?.[session.scenario] ?? listening?.talk_ratio_max ?? 0.5;
  const talk = computeTalkStats(turns, limit, session.input_mode);

  // Speaking metrics are computed in code. The scorer is given them as facts it may refer to, but must not re-judge them.
  const metrics = computeCallMetrics(turns, session.input_mode, session.duration_ms);
  const metricsLine = metrics.timed
    ? `Speaking metrics (computed by code, for reference): about ${metrics.wpm} words per minute, ${metrics.filler_count} filler words (${metrics.filler_pct}% of the rep's words; speech-to-text often removes fillers, so this is a minimum), longest stretch talking ${metrics.longest_monologue_s}s, ${metrics.questions} questions asked.`
    : `Speaking metrics: ${metrics.filler_count} filler words, ${metrics.questions} questions asked (pace is not measurable for this call).`;

  const rubricForPrompt = [
    ...core.criteria.map((c) => ({ id: c.id, section: "core", name: c.name, max: c.max, question: c.question, full_marks: c.full })),
    ...mod.criteria.map((c) => ({ id: c.id, section: `module: ${mod.label} (${mod.framework})`, name: c.name, max: c.max, question: c.question, full_marks: c.full })),
  ];

  const b = config.business;
  const facts = {
    company: b.company,
    rate: `${b.rate.symbol}${b.rate.per_hour} per hour`,
    monday_pricing: b.monday_pricing,
    discount_rule: b.discount_rule,
  };

  const userText = `# Scenario
${scenario.label}. ${scenario.starting_situation}
Success condition: ${scenario.success_condition}
Difficulty: ${session.difficulty}. Prospect personality: ${session.personality}. Department: ${session.department}. Company size: ${session.company_size}.
Prospect: ${session.prospect_name}, ${session.prospect_title} at ${session.prospect_company}.

# Rubric (return one entry per criterion id, all of them)
${JSON.stringify(rubricForPrompt, null, 2)}

# Accuracy rules
${accuracy.instructions}

# Business facts (the only source of truth for accuracy)
${JSON.stringify(facts, null, 2)}

# Hidden profile of the prospect (what the rep could have uncovered)
${PROFILE_FIELDS.map((f) => `- ${f.key} (${f.label}): ${secrets.profile[f.key]}`).join("\n")}

# Call facts
${metricsLine}
Input mode: ${session.input_mode}. ${
    talk.available
      ? `The rep spoke ${(talk.rep_share * 100).toFixed(0)}% of the talk time (limit ${(limit * 100).toFixed(0)}%). This is handled by code; do not judge it.`
      : "Talk ratio is not available for this call."
  }
The call ended because: ${session.ended_by ?? "unknown"}.

# Transcript
${transcriptText(turns)}`;

  // The vendor (Claude or OpenAI) is chosen by getProvider(); this file only cares about the JSON coming back.
  const response = await getProvider().scoreJson({ system: SYSTEM_PROMPT, user: userText, schema: OUTPUT_JSON_SCHEMA });

  if (response.refused) throw new RefusalError(response.refusalCategory);
  if (response.truncated) throw new Error("Scoring output was cut off (max tokens). Raise the scorer's max tokens in config/ai.json.");
  if (!response.text) throw new Error("Scorer returned no text.");

  const parsed = ModelOutput.parse(JSON.parse(response.text));
  const servedBy = response.model;

  // ---- Assemble the final result in code ----
  const byId = new Map(parsed.criteria.map((c) => [c.id, c]));

  const build = (
    section: "core" | "module",
    defs: { id: string; name: string; max: number }[],
  ): CriterionResult[] =>
    defs.map((def) => {
      const m = byId.get(def.id);
      let grade: Grade = m?.grade ?? "zero";
      let note: string | undefined = m ? undefined : "The scorer did not return this criterion, so it scored zero.";

      // Talk-ratio cap (computed in code, from timestamps).
      if (def.id === "core_listening" && talk.over_limit) {
        const capGrade = listening?.over_ratio_cap_grade ?? "partial";
        const rank: Record<Grade, number> = { zero: 0, partial: 1, full: 2 };
        if (rank[grade] > rank[capGrade]) {
          grade = capGrade;
          note = `Capped: you spoke ${(talk.rep_share * 100).toFixed(0)}% of the time (limit ${(limit * 100).toFixed(0)}%).`;
        }
      }
      return {
        id: def.id,
        name: def.name,
        section,
        points: pointsFor(def.max, grade),
        max: def.max,
        grade,
        quote: m?.quote ?? "",
        turn: m?.turn ?? 0,
        tip: m?.tip ?? "",
        improve: m?.improve ?? "",
        note,
      };
    });

  const coreResults = build("core", core.criteria);
  const moduleResults = build("module", mod.criteria);

  const errors = parsed.accuracy_errors;
  const accuracyPoints = Math.max(0, accuracy.max - errors.length * accuracy.penalty_wrong_fact);

  const sum = (rs: CriterionResult[]) => rs.reduce((n, r) => n + r.points, 0);
  const sections: SectionResult[] = [
    { key: "core", label: core.label, points: sum(coreResults), max: core.criteria.reduce((n, c) => n + c.max, 0) },
    { key: "module", label: mod.label, points: sum(moduleResults), max: mod.criteria.reduce((n, c) => n + c.max, 0) },
    { key: "accuracy", label: accuracy.label, points: accuracyPoints, max: accuracy.max },
  ];

  const findings: ProfileFinding[] = PROFILE_FIELDS.map((f) => {
    const m = parsed.profile_findings.find((p) => p.key === f.key);
    return {
      key: f.key,
      label: f.label,
      truth: secrets.profile[f.key],
      uncovered: m?.uncovered ?? false,
      evidence: m?.evidence ?? "",
    };
  });

  const result: ScoreResult = {
    total: sections.reduce((n, s) => n + s.points, 0),
    pass: parsed.success_condition_met,
    success_condition: scenario.success_condition,
    success_evidence: parsed.success_evidence,
    sections,
    criteria: [...coreResults, ...moduleResults],
    accuracy_errors: errors,
    top_improvements: parsed.top_improvements.slice(0, 3),
    key_moments: parsed.key_moments,
    profile_uncovered: findings.filter((f) => f.uncovered),
    profile_missed: findings.filter((f) => !f.uncovered),
    summary: parsed.summary,
    strengths: parsed.strengths.slice(0, 3),
    metrics,
    talk,
    scenario_label: scenario.label,
  };

  return { result, model: servedBy };
}
