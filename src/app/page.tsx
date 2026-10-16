import Link from "next/link";
import { Progress, type ScoredCall } from "@/app/history/Progress";
import { getSetupOptions } from "@/lib/config/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/db/tables";
import { accessFor } from "@/lib/team/access";
import type { CriterionResult, ScoreResult } from "@/lib/types";

export const dynamic = "force-dynamic";

type Score = { total: number; pass: boolean; criteria: CriterionResult[] | null };
type Row = { id: string; scenario: string; started_at: string; scores: Score | Score[] | null };

/** Days in a row (ending today or yesterday) with at least one call. */
function streak(dates: string[]): number {
  const days = new Set(dates.map((d) => new Date(d).toDateString()));
  const day = new Date();
  if (!days.has(day.toDateString())) day.setDate(day.getDate() - 1);
  let n = 0;
  while (days.has(day.toDateString())) {
    n += 1;
    day.setDate(day.getDate() - 1);
  }
  return n;
}

// Home: an overview of your practice. Starting a call happens on the New call page.
export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await accessFor(user);

  // Row-level security limits this to the signed-in person's own calls.
  const { data } = await supabase
    .from(TABLES.sessions)
    .select(`id, scenario, started_at, scores:${TABLES.scores}(total, pass, criteria:result_json->criteria)`)
    .in("status", ["ended", "scored", "score_failed"])
    .order("started_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];
  const scoreOf = (r: Row) => (Array.isArray(r.scores) ? r.scores[0] : r.scores) ?? null;
  const scored = rows.filter((r) => scoreOf(r));

  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = rows.filter((r) => new Date(r.started_at).getTime() > weekAgo).length;
  const totals = scored.map((r) => scoreOf(r)!.total);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const last5 = avg(totals.slice(0, 5));
  const prev5 = avg(totals.slice(5, 10));
  const best = totals.length ? Math.max(...totals) : null;
  const days = streak(rows.map((r) => r.started_at));

  const scenarioLabel = new Map(getSetupOptions().scenarios.map((s) => [s.value, s.label]));
  const callTypes = getSetupOptions().scenarios;
  const progressCalls: ScoredCall[] = scored.slice(0, 20).map((r) => {
    const s = scoreOf(r)!;
    return { id: r.id, scenario: r.scenario, startedAt: r.started_at, result: { total: s.total, pass: s.pass, criteria: s.criteria ?? [] } as unknown as ScoreResult };
  });

  const firstName = (user?.email ?? "").split("@")[0].split(/[._-]/)[0];
  const name = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : "";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-indigo-600 p-6 text-white shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">{name ? `Hi ${name}` : "Welcome"}</h1>
          <p className="mt-1 text-indigo-100">
            {rows.length === 0
              ? "Your first practice call takes about five minutes. Use headphones for the best experience."
              : thisWeek === 0
                ? "No practice yet this week. A quick call keeps you sharp."
                : `${thisWeek} call${thisWeek === 1 ? "" : "s"} this week${days > 1 ? `, ${days} days in a row` : ""}. Keep it going.`}
          </p>
        </div>
        <Link href="/setup" className="rounded-lg bg-white px-5 py-3 font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50">
          Start a practice call
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="py-1 text-slate-500">Jump straight to:</span>
        {callTypes.map((s) => (
          <Link key={s.value} href={`/setup?scenario=${s.value}`} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:border-indigo-400">
            {s.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls this week" value={String(thisWeek)} />
        <Stat label="Days in a row" value={String(days)} sub={days === 0 ? "practise today to start a streak" : undefined} />
        <Stat
          label="Average, last 5"
          value={last5 == null ? "—" : String(last5)}
          sub={last5 != null && prev5 != null ? `${last5 - prev5 >= 0 ? "▲" : "▼"} ${Math.abs(last5 - prev5)} vs the 5 before` : undefined}
        />
        <Stat label="Best score" value={best == null ? "—" : String(best)} />
      </div>

      {progressCalls.length >= 2 ? (
        <Progress calls={progressCalls} />
      ) : (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          After two scored calls you&apos;ll see your score trend and the skills to work on here.
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm md:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold">Recent calls</h2>
            {rows.length > 0 && (
              <Link href="/history" className="text-sm text-indigo-600 hover:underline">
                All calls →
              </Link>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No calls yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.slice(0, 5).map((r) => {
                const s = scoreOf(r);
                return (
                  <li key={r.id}>
                    <Link href={`/report/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                      <span>
                        <span className="font-medium">{scenarioLabel.get(r.scenario) ?? r.scenario}</span>
                        <span className="ml-2 text-slate-500">
                          {new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </span>
                      {s ? (
                        <span className="flex items-center gap-2">
                          <span className="font-semibold">{s.total}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                            {s.pass ? "Pass" : "Fail"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700">Not scored</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {access.isManager && (
            <Link href="/team" className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300">
              <p className="font-semibold">Team overview →</p>
              <p className="text-sm text-slate-600">Everyone&apos;s practice, scores and who needs coaching.</p>
            </Link>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-800">Tips for a good session</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Wear headphones so the prospect can&apos;t hear itself.</li>
              <li>Speak as you would on a real call, pauses and all.</li>
              <li>Try hiding the transcript for a more realistic call.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
