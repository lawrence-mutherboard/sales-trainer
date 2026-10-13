import Link from "next/link";
import type { ScoreResult } from "@/lib/types";

export interface ScoredCall {
  id: string;
  scenario: string;
  startedAt: string;
  result: ScoreResult;
}

interface Weak {
  name: string;
  avgPct: number;
  calls: number;
  tip: string;
}

/** Average percentage per criterion over the given calls, lowest first. A criterion needs to appear in 2+ calls to count. */
function weakest(calls: ScoredCall[]): Weak[] {
  const byId = new Map<string, { name: string; pts: number; max: number; n: number; tip: string }>();
  for (const call of calls) {
    for (const c of call.result.criteria ?? []) {
      if (!c.max) continue;
      const cur = byId.get(c.id) ?? { name: c.name, pts: 0, max: 0, n: 0, tip: "" };
      cur.pts += c.points;
      cur.max += c.max;
      cur.n += 1;
      // `calls` is newest first, so the first tip we see is the most recent one.
      if (!cur.tip && c.grade !== "full") cur.tip = c.improve || c.tip || "";
      byId.set(c.id, cur);
    }
  }
  return [...byId.values()]
    .filter((c) => c.n >= 2)
    .map((c) => ({ name: c.name, avgPct: Math.round((c.pts / c.max) * 100), calls: c.n, tip: c.tip }))
    .sort((a, b) => a.avgPct - b.avgPct)
    .slice(0, 3);
}

/** Score trend and weakest skills over the rep's recent scored calls (newest first in `calls`). */
export function Progress({ calls }: { calls: ScoredCall[] }) {
  if (calls.length < 2) return null;
  const chronological = [...calls].reverse().slice(-10);
  const scores = chronological.map((c) => c.result.total);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const best = Math.max(...scores);
  const last = scores[scores.length - 1];
  const first = scores[0];
  const change = last - first;
  const weak = weakest(calls);

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Your progress</h2>
        <p className="text-sm text-slate-500">Score of your last {scores.length} scored calls, oldest to newest.</p>
        <div className="mt-4 flex h-28 items-end gap-1.5" role="img" aria-label={`Scores: ${scores.join(", ")}`}>
          {chronological.map((c, i) => (
            <Link
              key={c.id}
              href={`/report/${c.id}`}
              title={`${new Date(c.startedAt).toLocaleDateString("en-GB")} · ${c.scenario.replace(/_/g, " ")} · ${c.result.total}/100`}
              className="group flex h-full flex-1 flex-col justify-end"
            >
              <span className="mb-0.5 text-center text-[10px] text-slate-500">{scores[i]}</span>
              <span
                className={`block w-full rounded-t ${c.result.pass ? "bg-emerald-500 group-hover:bg-emerald-600" : "bg-indigo-400 group-hover:bg-indigo-500"}`}
                style={{ height: `${Math.max(4, scores[i])}%` }}
              />
            </Link>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-700">
          Average <strong>{avg}</strong> · best <strong>{best}</strong> ·{" "}
          {change === 0 ? "no change since your first call here" : `${change > 0 ? "up" : "down"} ${Math.abs(change)} since your first call here`}.
        </p>
        <p className="mt-1 text-xs text-slate-400">Green bars passed. Hover or tap a bar for the details, click it to open the report.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">What to work on</h2>
        <p className="text-sm text-slate-500">Your lowest-scoring skills across your last {calls.length} calls.</p>
        {weak.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Not enough calls yet to spot a pattern.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {weak.map((w) => (
              <li key={w.name}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{w.name}</span>
                  <span className="text-slate-500">{w.avgPct}% on average</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${Math.max(3, w.avgPct)}%` }} />
                </div>
                {w.tip && <p className="mt-1 text-sm text-slate-600">{w.tip}</p>}
              </li>
            ))}
          </ul>
        )}
        <Link href="/setup" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Practise now
        </Link>
      </div>
    </div>
  );
}
