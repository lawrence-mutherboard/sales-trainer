import "server-only";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";
import type { CallMetrics, CriterionResult, TalkStats } from "@/lib/types";
import { isFixedAdminEmail, isListedManager, isOwnerEmail } from "./access";

// Numbers for the manager's Team pages. Read with the service role (the pages check the viewer is a manager first), and
// only the parts of each report that are needed: totals, the per-skill grades and the speaking metrics, not transcripts.

export interface Person {
  id: string;
  email: string;
  name: string;
  isManager: boolean;
  isAdmin: boolean;
  /** Owner (config/team.json -> owners): can make admins. */
  isOwner: boolean;
  /** Owner or admin set by email: can't be changed from the Admin page. */
  isFixedAdmin: boolean;
  /** Access turned off on the Admin page. */
  disabled: boolean;
  joinedAt: string;
}

export interface CallRow {
  id: string;
  repId: string;
  scenario: string;
  status: string;
  startedAt: string;
  durationMs: number | null;
  difficulty: string;
  personality: string;
  prospect: string;
  total: number | null;
  pass: boolean | null;
  criteria: CriterionResult[] | null;
  metrics: CallMetrics | null;
  talk: TalkStats | null;
}

export interface Skill {
  name: string;
  avgPct: number;
  count: number;
  tip: string;
}

export interface RepSummary {
  person: Person;
  calls: number;
  scored: number;
  avg: number | null;
  best: number | null;
  passRate: number | null;
  lastAt: string | null;
  practiceMin: number;
  /** Average of the newer half of scored calls minus the older half (needs 4+ scored calls). */
  trend: number | null;
  weakest: Skill | null;
  fillerPct: number | null;
  talkShare: number | null;
  wpm: number | null;
}

/** "lawrence.smith@…" -> "Lawrence Smith" when no name was given at sign-up. */
export function displayName(email: string, name: string | null): string {
  if (name?.trim()) return name.trim();
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function scenarioLabel(key: string): string {
  return config.scenarios[key]?.label ?? key.replace(/_/g, " ");
}

export async function loadPeople(): Promise<Person[]> {
  // select("*") so this works before the "disabled" column exists (supabase/migrations/0002_trainer_access.sql).
  const { data, error } = await supabaseAdmin().from(TABLES.profiles).select("*");
  if (error) console.error("team: could not read profiles", error);
  type Row = { id: string; email: string; name: string | null; role?: string | null; disabled?: boolean | null; created_at: string };
  const hidden = new Set(config.team.hidden.map((e) => e.toLowerCase()));
  return ((data ?? []) as Row[]).filter((p) => !hidden.has(p.email.toLowerCase())).map((p) => {
    const isFixedAdmin = isFixedAdminEmail(p.email);
    const isAdmin = isFixedAdmin || p.role === "admin";
    return {
      id: p.id,
      email: p.email,
      name: displayName(p.email, p.name),
      isAdmin,
      isOwner: isOwnerEmail(p.email),
      isFixedAdmin,
      isManager: isAdmin || isListedManager(p.email) || p.role === "manager",
      disabled: !isFixedAdmin && Boolean(p.disabled),
      joinedAt: p.created_at,
    };
  });
}

/** Finished calls (newest first), optionally for one person and/or since a date. */
export async function loadCalls(opts: { since?: string | null; repId?: string; limit?: number } = {}): Promise<CallRow[]> {
  let q = supabaseAdmin()
    .from(TABLES.sessions)
    .select(
      `id, rep_id, scenario, status, started_at, duration_ms, difficulty, personality, prospect_name, prospect_company, scores:${TABLES.scores}(total, pass, criteria:result_json->criteria, metrics:result_json->metrics, talk:result_json->talk)`,
    )
    .in("status", ["ended", "scored", "score_failed"])
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 1000);
  if (opts.since) q = q.gte("started_at", opts.since);
  if (opts.repId) q = q.eq("rep_id", opts.repId);
  const { data, error } = await q;
  if (error) console.error("team: could not read calls", error);

  type Raw = {
    id: string;
    rep_id: string;
    scenario: string;
    status: string;
    started_at: string;
    duration_ms: number | null;
    difficulty: string;
    personality: string;
    prospect_name: string;
    prospect_company: string;
    scores:
      | { total: number; pass: boolean; criteria: CriterionResult[] | null; metrics: CallMetrics | null; talk: TalkStats | null }
      | { total: number; pass: boolean; criteria: CriterionResult[] | null; metrics: CallMetrics | null; talk: TalkStats | null }[]
      | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const s = Array.isArray(r.scores) ? r.scores[0] : r.scores;
    return {
      id: r.id,
      repId: r.rep_id,
      scenario: r.scenario,
      status: r.status,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      difficulty: r.difficulty,
      personality: r.personality,
      prospect: `${r.prospect_name}, ${r.prospect_company}`,
      total: s?.total ?? null,
      pass: s?.pass ?? null,
      criteria: s?.criteria ?? null,
      metrics: s?.metrics ?? null,
      talk: s?.talk ?? null,
    };
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Average score per skill (criterion) across calls, lowest first. A skill needs `minCount` calls to count. */
export function skills(calls: CallRow[], minCount = 2): Skill[] {
  const by = new Map<string, { name: string; pts: number; max: number; n: number; tip: string }>();
  for (const c of calls) {
    for (const cr of c.criteria ?? []) {
      if (!cr.max) continue;
      const cur = by.get(cr.id) ?? { name: cr.name, pts: 0, max: 0, n: 0, tip: "" };
      cur.pts += cr.points;
      cur.max += cr.max;
      cur.n += 1;
      if (!cur.tip && cr.grade !== "full") cur.tip = cr.improve || cr.tip || ""; // calls are newest first
      by.set(cr.id, cur);
    }
  }
  return [...by.values()]
    .filter((s) => s.n >= minCount)
    .map((s) => ({ name: s.name, avgPct: Math.round((s.pts / s.max) * 100), count: s.n, tip: s.tip }))
    .sort((a, b) => a.avgPct - b.avgPct);
}

export function summarise(person: Person, calls: CallRow[]): RepSummary {
  const scored = calls.filter((c) => c.total != null);
  const totals = scored.map((c) => c.total as number);
  // Trend: newer half vs older half of the scored calls (calls are newest first).
  let trend: number | null = null;
  if (totals.length >= 4) {
    const half = Math.floor(totals.length / 2);
    trend = Math.round((mean(totals.slice(0, half)) as number) - (mean(totals.slice(totals.length - half)) as number));
  }
  const timed = scored.filter((c) => c.metrics?.timed);
  const talked = scored.filter((c) => c.talk?.available);
  const avg = mean(totals);
  const filler = mean(timed.map((c) => c.metrics!.filler_pct));
  const talk = mean(talked.map((c) => c.talk!.rep_share));
  const wpm = mean(timed.map((c) => c.metrics!.wpm ?? 0).filter(Boolean));
  return {
    person,
    calls: calls.length,
    scored: scored.length,
    avg: avg == null ? null : Math.round(avg),
    best: totals.length ? Math.max(...totals) : null,
    passRate: scored.length ? Math.round((scored.filter((c) => c.pass).length / scored.length) * 100) : null,
    lastAt: calls[0]?.startedAt ?? null,
    practiceMin: Math.round(calls.reduce((n, c) => n + (c.durationMs ?? 0), 0) / 60000),
    trend,
    weakest: skills(scored)[0] ?? null,
    fillerPct: filler == null ? null : Math.round(filler * 10) / 10,
    talkShare: talk == null ? null : Math.round(talk * 100),
    wpm: wpm == null ? null : Math.round(wpm),
  };
}

/** Period from the page's ?days= value: 7, 30 (default), 90 or "all". */
export function periodFrom(value: string | undefined): { days: number | null; since: string | null; label: string } {
  const days = value === "all" ? null : [7, 30, 90].includes(Number(value)) ? Number(value) : 30;
  return {
    days,
    since: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
    label: days ? `last ${days} days` : "all time",
  };
}

export function daysAgo(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
}

