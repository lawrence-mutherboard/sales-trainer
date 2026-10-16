import Link from "next/link";
import { getSetupOptions } from "@/lib/config/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/db/tables";
import { QuickStart } from "./QuickStart";

export const dynamic = "force-dynamic";

type Row = { id: string; scenario: string; started_at: string; scores: { total: number; pass: boolean } | { total: number; pass: boolean }[] | null };

// Home: start practising in one click, and see where you stand.
export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Row-level security limits this to the signed-in person's own calls.
  const { data } = await supabase
    .from(TABLES.sessions)
    .select(`id, scenario, started_at, scores:${TABLES.scores}(total, pass)`)
    .in("status", ["ended", "scored", "score_failed"])
    .order("started_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as Row[];
  const score = (r: Row) => (Array.isArray(r.scores) ? r.scores[0] : r.scores);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = rows.filter((r) => new Date(r.started_at).getTime() > weekAgo).length;
  const recent = rows.map(score).filter((s): s is { total: number; pass: boolean } => !!s).slice(0, 5);
  const recentAvg = recent.length ? Math.round(recent.reduce((n, s) => n + s.total, 0) / recent.length) : null;
  const last = rows[0];

  const options = getSetupOptions();
  const firstName = (user?.email ?? "").split("@")[0].split(/[._-]/)[0];
  const name = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : "";

  return (
    <div>
      <h1 className="text-2xl font-semibold">{name ? `Hi ${name}, ready to practise?` : "Ready to practise?"}</h1>
      <p className="mt-1 text-slate-600">
        Pick a call. You&apos;ll get a random prospect, like a real call to someone you don&apos;t know. Use headphones for the best experience.
      </p>

      <div className="mt-5">
        <QuickStart
          scenarios={options.scenarios.map((s) => ({ value: s.value, label: s.label, minutes: s.minutes, brief: s.brief }))}
          sizes={options.sizes}
          departments={options.departments}
        />
        <p className="mt-3 text-sm">
          <Link href="/setup" className="text-indigo-600 hover:underline">
            Or choose the company, department, personality and difficulty yourself →
          </Link>
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Calls this week</p>
          <p className="mt-1 text-2xl font-semibold">{thisWeek}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Average of last 5</p>
          <p className="mt-1 text-2xl font-semibold">{recentAvg ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last call</p>
          {last ? (
            <Link href={`/report/${last.id}`} className="mt-1 block text-indigo-600 hover:underline">
              {score(last) ? `${score(last)!.total}/100` : "Not scored"} ·{" "}
              {new Date(last.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </Link>
          ) : (
            <p className="mt-1 text-slate-500">None yet</p>
          )}
        </div>
      </div>
      {rows.length > 0 && (
        <p className="mt-3 text-sm">
          <Link href="/history" className="text-indigo-600 hover:underline">
            See all your calls and progress →
          </Link>
        </p>
      )}
    </div>
  );
}
