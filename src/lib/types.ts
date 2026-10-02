// Types and constants that are safe to import from both server and browser code.
// (Nothing here reveals hidden profile data or business config.)

export type Speaker = "rep" | "prospect";

export interface TurnRow {
  id: string;
  session_id: string;
  idx: number;
  speaker: Speaker;
  text: string;
  started_ms: number | null;
  ended_ms: number | null;
}

export interface SessionRow {
  id: string;
  rep_id: string;
  company_size: string;
  department: string;
  personality: string;
  scenario: string;
  difficulty: string;
  prospect_name: string;
  prospect_title: string;
  prospect_company: string;
  input_mode: "voice" | "typed";
  status: "ready" | "in_progress" | "ended" | "scored" | "score_failed";
  ended_by: "rep" | "prospect" | "timeout" | null;
  duration_ms: number | null;
  started_at: string;
  ended_at: string | null;
}

// Fields of the per-call hidden profile. Order = order shown in the report.
export const PROFILE_FIELDS = [
  { key: "current_tools", label: "Current tools" },
  { key: "real_pain", label: "Real pain" },
  { key: "cost_of_pain", label: "Cost of the pain" },
  { key: "budget", label: "Budget" },
  { key: "decision_maker", label: "Decision maker" },
  { key: "decision_process_timeline", label: "Decision process and timeline" },
  { key: "competing_options", label: "Competing options" },
  { key: "success_metric", label: "How success would be measured" },
  { key: "champion", label: "Internal champion" },
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]["key"];

export interface HiddenProfile {
  current_tools: string;
  surface_complaint: string;
  real_pain: string;
  cost_of_pain: string;
  budget: string; // e.g. "£6,000–£12,000, approved"
  decision_maker: string;
  decision_process_timeline: string;
  competing_options: string;
  success_metric: string;
  champion: string;
}

// What we store in session_secrets.hidden_profile (server only).
export interface SessionSecrets {
  profile: HiddenProfile;
  objection_ids: string[];
  staff_count: number;
  boss_title: string;
}

// ---- Score result (stored in scores.result_json and shown in the report) ----

export type Grade = "full" | "partial" | "zero";

export interface CriterionResult {
  id: string;
  name: string;
  section: "core" | "module";
  points: number;
  max: number;
  grade: Grade;
  quote: string;
  turn: number; // 1-based transcript turn number, 0 if none
  tip: string;
  /** What would earn more points (or, at full marks, what excellent would add). Added later, so older reports lack it. */
  improve?: string;
  note?: string; // e.g. talk-ratio cap explanation
}

export interface SectionResult {
  key: "core" | "module" | "accuracy";
  label: string;
  points: number;
  max: number;
}

export interface AccuracyError {
  quote: string;
  turn: number;
  issue: string;
}

export interface Improvement {
  title: string;
  moment_quote: string;
  turn: number;
  example_line: string;
}

export interface KeyMoment {
  turn: number;
  kind: "strength" | "miss";
  label: string;
}

export interface ProfileFinding {
  key: ProfileFieldKey;
  label: string;
  truth: string; // the hidden value, revealed after the call
  uncovered: boolean;
  evidence: string;
}

/** Speaking metrics computed in code from the transcript and timestamps (not judged by the AI). */
export interface CallMetrics {
  /** False for typed calls and very short calls: pace and monologue length cannot be measured. */
  timed: boolean;
  rep_words: number;
  prospect_words: number;
  wpm: number | null;
  filler_count: number;
  filler_pct: number;
  fillers: { word: string; count: number }[];
  longest_monologue_s: number | null;
  questions: number;
  call_seconds: number | null;
}

export interface ScoreResult {
  /** What went well (added later, so older reports lack it). */
  strengths?: string[];
  /** Speaking metrics (added later, so older reports lack it). */
  metrics?: CallMetrics;
  total: number;
  pass: boolean;
  success_condition: string;
  success_evidence: string;
  sections: SectionResult[];
  criteria: CriterionResult[];
  accuracy_errors: AccuracyError[];
  top_improvements: Improvement[];
  key_moments: KeyMoment[];
  profile_uncovered: ProfileFinding[];
  profile_missed: ProfileFinding[];
  summary: string;
  talk: TalkStats;
  scenario_label: string;
}

export interface TalkStats {
  available: boolean; // false for typed calls
  rep_ms: number;
  prospect_ms: number;
  rep_share: number; // 0..1
  limit: number;
  over_limit: boolean;
}

// The prospect appends this to its final line to hang up. The server strips it before anything is stored or spoken.
export const END_CALL_MARKER = "[[END_CALL]]";
