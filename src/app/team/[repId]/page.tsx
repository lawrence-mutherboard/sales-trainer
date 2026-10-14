import Link from "next/link";
import { notFound } from "next/navigation";
import { Progress, type ScoredCall } from "@/app/history/Progress";
import { requireManager } from "@/lib/team/access";
import { isUuid } from "@/lib/api/auth";
import { daysAgo, loadCalls, loadPeople, periodFrom, scenarioLabel, skills, summarise } from "@/lib/team/stats";
import type { ScoreResult } from "@/lib/types";
import { PeriodTabs, ScoreBadge, SkillBars, Tile, Trend, fmtDate, hours, lastSeen } from "../ui";

export const dynamic = "force-dynamic";

// One person's practice, for their manager: scores over time, per scenario, strongest and weakest skills, speaking
// habits, and every call with a link to its full report.
export default async function RepPage({
  params,
  searchParams,
}: {
  params: Promise<{ repId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  await requireManager();
  const { repId } = await params;
  if (!isUuid(repId)) notFound();
  const sp = await searchParams;
  const period = periodFrom(sp.days);
  const daysParam = period.days ? String(period.days) : "all";

  const [people, calls] = await Promise.all([loadPeople(), loadCalls({ since: period.since, repId })]);
  const person = people.find((p) => p.id === repId);
  if (!person) notFound();

  const s = summarise(person, calls);
  const scored = calls.filter((c) => c.total != null);
  const ranked = skills(scored);
  const first = person.name.split(" ")[0];

  const byScenario = new Map<string, typeof calls>();
  for (const c of calls) byScenario.set(c.scenario, [...(byScenario.get(c.scenario) ?? []), c]);

  const progressCalls: ScoredCall[] = scored.map((c) => ({
    id: c.id,
    scenario: c.scenario,
    startedAt: c.startedAt,
    result: { total: c.total, pass: c.pass, criteria: c.criteria ?? [] } as unknown as ScoreResult,
  }));

  return (
    <div>
      <Link href={`/team?days=${daysParam}`} className="text-sm text-indigo-600 hover:underline">
        ← Team
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{person.name}</h1>
          <p className="text-slate-600">
            {person.email} · last practised {lastSeen(daysAgo(s.lastAt)).toLowerCase()}
          </p>
        </div>
        <PeriodTabs base={`/team/${person.id}`} current={daysParam} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="Calls" value={String(s.calls)} sub={`${s.scored} scored`} />
        <Tile label="Average" value={s.avg == null ? "—" : String(s.avg)} />
        <Tile label="Best" value={s.best == null ? "—" : String(s.best)} />
        <Tile label="Pass rate" value={s.passRate == null ? "—" : `${s.passRate}%`} />
        <Tile label="Practice time" value={hours(s.practiceMin)} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Trend</p>
          <p className="mt-1 text-2xl font-semibold">
            <Trend value={s.trend} />
          </p>
          <p className="text-xs text-slate-500">newer vs older calls</p>
        </div>
      </div>

      {calls.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">
          {first} has no calls {period.label === "all time" ? "yet" : `in the ${period.label}`}.
        </div>
      ) : (
        <>
          <Progress calls={progressCalls} who={first} />

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Strongest skills</h2>
              <SkillBars skills={[...ranked].reverse().slice(0, 3).map((k) => ({ ...k, tip: "" }))} empty="Needs at least two scored calls." />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Speaking habits</h2>
              <p className="text-sm text-slate-500">Averages over voice calls. Targets are common coaching benchmarks.</p>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Filler words</dt>
                  <dd className={`text-xl font-semibold ${s.fillerPct != null && s.fillerPct > 3 ? "text-amber-700" : ""}`}>
                    {s.fillerPct == null ? "—" : `${s.fillerPct}%`}
                  </dd>
                  <dd className="text-[11px] text-slate-400">target under 3%</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Talk time</dt>
                  <dd className={`text-xl font-semibold ${s.talkShare != null && s.talkShare > 60 ? "text-amber-700" : ""}`}>
                    {s.talkShare == null ? "—" : `${s.talkShare}%`}
                  </dd>
                  <dd className="text-[11px] text-slate-400">under about 55–60%</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Pace</dt>
                  <dd className={`text-xl font-semibold ${s.wpm != null && (s.wpm > 170 || s.wpm < 110) ? "text-amber-700" : ""}`}>
                    {s.wpm == null ? "—" : s.wpm}
                  </dd>
                  <dd className="text-[11px] text-slate-400">125–150 words/min</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">By scenario</h2>
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Scenario</th>
                  <th className="px-4 py-2 font-medium">Calls</th>
                  <th className="px-4 py-2 font-medium">Average</th>
                  <th className="px-4 py-2 font-medium">Best</th>
                  <th className="px-4 py-2 font-medium">Pass rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...byScenario.entries()].map(([key, list]) => {
                  const sum = summarise(person, list);
                  return (
                    <tr key={key}>
                      <td className="px-4 py-2 font-medium">{scenarioLabel(key)}</td>
                      <td className="px-4 py-2">{sum.calls}</td>
                      <td className="px-4 py-2">{sum.avg ?? "—"}</td>
                      <td className="px-4 py-2">{sum.best ?? "—"}</td>
                      <td className="px-4 py-2">{sum.passRate == null ? "—" : `${sum.passRate}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Calls</h2>
            <table className="w-full min-w-[680px] text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {calls.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-500">{fmtDate(c.startedAt)}</td>
                    <td className="px-4 py-2">{scenarioLabel(c.scenario)}</td>
                    <td className="px-4 py-2 text-slate-600">{c.prospect}</td>
                    <td className="px-4 py-2 capitalize text-slate-500">
                      {c.difficulty} · {c.personality}
                    </td>
                    <td className="px-4 py-2">
                      <ScoreBadge total={c.total} pass={c.pass} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/report/${c.id}`} className="text-indigo-600 hover:underline">
                        Open report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
