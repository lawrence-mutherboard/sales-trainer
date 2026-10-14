import Link from "next/link";
import { config } from "@/lib/config";
import { requireManager } from "@/lib/team/access";
import { daysAgo, loadCalls, loadPeople, periodFrom, scenarioLabel, skills, summarise, type RepSummary } from "@/lib/team/stats";
import { PeriodTabs, ScoreBadge, SkillBars, Tile, Trend, fmtDate, hours, lastSeen } from "./ui";

export const dynamic = "force-dynamic";

const SORTS: Record<string, { label: string; by: (a: RepSummary, b: RepSummary) => number }> = {
  calls: { label: "Calls", by: (a, b) => b.calls - a.calls },
  avg: { label: "Average score", by: (a, b) => (b.avg ?? -1) - (a.avg ?? -1) },
  trend: { label: "Improvement", by: (a, b) => (b.trend ?? -999) - (a.trend ?? -999) },
  recent: { label: "Last practised", by: (a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") },
  name: { label: "Name", by: (a, b) => a.person.name.localeCompare(b.person.name) },
};

// The manager's overview: who is practising, how they score, where the team is weakest, and the latest calls.
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ days?: string; sort?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const period = periodFrom(sp.days);
  const sortKey = sp.sort && SORTS[sp.sort] ? sp.sort : "calls";
  const daysParam = period.days ? String(period.days) : "all";

  const [people, calls] = await Promise.all([loadPeople(), loadCalls({ since: period.since })]);
  const byRep = new Map<string, typeof calls>();
  for (const c of calls) byRep.set(c.repId, [...(byRep.get(c.repId) ?? []), c]);
  const rows = people.map((p) => summarise(p, byRep.get(p.id) ?? [])).sort(SORTS[sortKey].by);

  const scored = calls.filter((c) => c.total != null);
  const avg = scored.length ? Math.round(scored.reduce((n, c) => n + (c.total ?? 0), 0) / scored.length) : null;
  const passRate = scored.length ? Math.round((scored.filter((c) => c.pass).length / scored.length) * 100) : null;
  const active = rows.filter((r) => r.calls > 0).length;
  const practiceMin = Math.round(calls.reduce((n, c) => n + (c.durationMs ?? 0), 0) / 60000);
  const teamSkills = skills(scored, 3).slice(0, 5);
  const inactiveDays = config.team.inactive_after_days;

  const scenarioCounts = new Map<string, number>();
  for (const c of calls) scenarioCounts.set(c.scenario, (scenarioCounts.get(c.scenario) ?? 0) + 1);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Team</h1>
          <p className="mt-1 text-slate-600">Everyone&apos;s practice and scores, {period.label}. Only managers can see this page.</p>
        </div>
        <PeriodTabs base="/team" current={daysParam} extra={`&sort=${sortKey}`} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Practising" value={`${active} / ${people.length}`} sub="people with at least one call" />
        <Tile label="Calls" value={String(calls.length)} sub={`${scored.length} scored`} />
        <Tile label="Practice time" value={hours(practiceMin)} />
        <Tile label="Average score" value={avg == null ? "—" : String(avg)} sub="out of 100" />
        <Tile label="Pass rate" value={passRate == null ? "—" : `${passRate}%`} />
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">People</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="py-1 text-slate-500">Sort by:</span>
            {Object.entries(SORTS).map(([k, s]) => (
              <Link
                key={k}
                href={`/team?days=${daysParam}&sort=${k}`}
                className={`rounded-full px-2.5 py-1 ${k === sortKey ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Calls</th>
              <th className="px-4 py-2 font-medium">Avg</th>
              <th className="px-4 py-2 font-medium">Best</th>
              <th className="px-4 py-2 font-medium">Pass rate</th>
              <th className="px-4 py-2 font-medium" title="Newer half of their scored calls compared with the older half">
                Trend
              </th>
              <th className="px-4 py-2 font-medium">Last practised</th>
              <th className="px-4 py-2 font-medium">Weakest skill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const ago = daysAgo(r.lastAt);
              const inactive = ago == null || ago > inactiveDays;
              return (
                <tr key={r.person.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/team/${r.person.id}?days=${daysParam}`} className="font-medium text-indigo-600 hover:underline">
                      {r.person.name}
                    </Link>
                    {r.person.isManager && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">Manager</span>}
                    <p className="text-xs text-slate-400">{r.person.email}</p>
                  </td>
                  <td className="px-4 py-3">{r.calls}</td>
                  <td className="px-4 py-3 font-semibold">{r.avg ?? "—"}</td>
                  <td className="px-4 py-3">{r.best ?? "—"}</td>
                  <td className="px-4 py-3">{r.passRate == null ? "—" : `${r.passRate}%`}</td>
                  <td className="px-4 py-3">
                    <Trend value={r.trend} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={inactive ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" : ""}>{lastSeen(ago)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.weakest ? `${r.weakest.name} (${r.weakest.avgPct}%)` : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  Nobody has signed in yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Amber: no practice in the last {inactiveDays} days. People appear here after they first sign in.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Coaching focus</h2>
          <p className="text-sm text-slate-500">The team&apos;s lowest-scoring skills, {period.label}.</p>
          <SkillBars skills={teamSkills} empty="Not enough scored calls yet." />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">What people practise</h2>
          {scenarioCounts.size === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No calls in this period.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {[...scenarioCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([s, n]) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className="w-36 shrink-0">{scenarioLabel(s)}</span>
                    <span className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(4, (n / calls.length) * 100)}%` }} />
                    <span className="text-slate-500">{n}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Latest calls</h2>
        <table className="w-full min-w-[640px] text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {calls.slice(0, 15).map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-500">{fmtDate(c.startedAt)}</td>
                <td className="px-4 py-2 font-medium">{nameOf.get(c.repId) ?? "Unknown"}</td>
                <td className="px-4 py-2">{scenarioLabel(c.scenario)}</td>
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
            {calls.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500">No calls in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
