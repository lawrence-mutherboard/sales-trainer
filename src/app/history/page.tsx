import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SessionRow } from "@/lib/types";
import { TABLES } from "@/lib/db/tables";

type Row = SessionRow & { scores: { total: number; pass: boolean }[] | { total: number; pass: boolean } | null };

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();

  // RLS limits this to the signed-in rep's own calls.
  const { data } = await supabase
    .from(TABLES.sessions)
    .select(`*, scores:${TABLES.scores}(total, pass)`)
    .in("status", ["ended", "scored", "score_failed"])
    .order("started_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <h1 className="text-2xl font-semibold">My calls</h1>
      <p className="mt-1 text-slate-600">Calls are kept for 90 days.</p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-600">No calls yet.</p>
          <Link href="/setup" className="mt-3 inline-block rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
            Start your first call
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Scenario</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Prospect</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Settings</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const score = Array.isArray(r.scores) ? r.scores[0] : r.scores;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/report/${r.id}`} className="text-indigo-600 hover:underline">
                        {new Date(r.started_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize">{r.scenario.replace(/_/g, " ")}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {r.prospect_name}
                      <span className="text-slate-400"> · {r.prospect_company}</span>
                    </td>
                    <td className="hidden px-4 py-3 capitalize text-slate-500 md:table-cell">
                      {r.company_size.replace("_", "-")} · {r.department} · {r.personality} · {r.difficulty}
                    </td>
                    <td className="px-4 py-3 font-semibold">{score ? `${score.total}/100` : "—"}</td>
                    <td className="px-4 py-3">
                      {score ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${score.pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                        >
                          {score.pass ? "Pass" : "Fail"}
                        </span>
                      ) : (
                        <Link href={`/report/${r.id}`} className="text-xs text-amber-700 hover:underline">
                          Not scored
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
