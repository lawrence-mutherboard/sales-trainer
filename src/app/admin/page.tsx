import { isListedManager, requireAdmin } from "@/lib/team/access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";
import { daysAgo, loadPeople } from "@/lib/team/stats";
import { lastSeen } from "@/app/team/ui";
import { setAccess, setManager } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  migration:
    "Turning access off needs one small database change first. In Supabase, open the SQL editor and run supabase/migrations/0002_trainer_access.sql, then try again.",
  admin: "Admins can't be changed here. They are set in config/team.json (or ADMIN_EMAILS on Render).",
  self: "You can't turn off your own access.",
  missing: "That account wasn't found. Refresh the page and try again.",
  save: "That change couldn't be saved. Try again.",
  bad: "Something went wrong with that request.",
};

// Admins: give or remove manager access, and turn anyone's access to the trainer off or on.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireAdmin();
  const { error } = await searchParams;

  const [people, { data: profileRows }, { data: sessionRows }] = await Promise.all([
    loadPeople(),
    supabaseAdmin().from(TABLES.profiles).select("*").limit(1),
    supabaseAdmin().from(TABLES.sessions).select("rep_id, started_at").order("started_at", { ascending: false }).limit(5000),
  ]);
  // Before the migration, profile rows have no "disabled" field.
  const accessColumnReady = !profileRows?.length || "disabled" in (profileRows[0] as object);

  const last = new Map<string, string>();
  const count = new Map<string, number>();
  for (const s of (sessionRows ?? []) as { rep_id: string; started_at: string }[]) {
    if (!last.has(s.rep_id)) last.set(s.rep_id, s.started_at);
    count.set(s.rep_id, (count.get(s.rep_id) ?? 0) + 1);
  }
  const sorted = [...people].sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || Number(b.isManager) - Number(a.isManager) || a.name.localeCompare(b.name));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-slate-600">
        Give people manager access (the Team page and everyone&apos;s call reports), or turn someone&apos;s access to the trainer off. Changes
        apply within about a minute. This only affects the sales trainer, never anyone&apos;s sign-in for other company apps.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{ERRORS[error] ?? ERRORS.save}</p>}
      {!accessColumnReady && !error && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{ERRORS.migration}</p>
      )}

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Calls</th>
              <th className="px-4 py-2 font-medium">Last practised</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((p) => {
              const fixedManager = !p.isAdmin && isListedManager(p.email);
              return (
                <tr key={p.id} className={p.disabled ? "bg-red-50/40" : ""}>
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {p.name}
                      {p.id === me.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-400">{p.email}</p>
                  </td>
                  <td className="px-4 py-3">{count.get(p.id) ?? 0}</td>
                  <td className="px-4 py-3">{lastSeen(daysAgo(last.get(p.id) ?? null))}</td>

                  <td className="px-4 py-3">
                    {p.isAdmin ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">Admin</span>
                    ) : fixedManager ? (
                      <span className="text-xs text-slate-600" title="Set in config/team.json or MANAGER_EMAILS">
                        Manager (set in config)
                      </span>
                    ) : (
                      <form action={setManager} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="manager" value={p.isManager ? "false" : "true"} />
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.isManager ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
                        >
                          {p.isManager ? "Manager" : "Rep"}
                        </span>
                        <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                          {p.isManager ? "Remove manager" : "Make manager"}
                        </button>
                      </form>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {p.isAdmin || p.id === me.id ? (
                      <span className="text-xs text-slate-500">Always on</span>
                    ) : (
                      <form action={setAccess} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="disabled" value={p.disabled ? "false" : "true"} />
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.disabled ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}
                        >
                          {p.disabled ? "Off" : "On"}
                        </span>
                        <button
                          className={`rounded-md border px-2 py-1 text-xs ${p.disabled ? "border-slate-300 hover:bg-slate-50" : "border-red-300 text-red-700 hover:bg-red-50"}`}
                        >
                          {p.disabled ? "Turn access on" : "Turn access off"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>
          <strong>Adding someone:</strong> they sign up themselves with their @mutherboard.com email and confirm it. They appear here after their
          first sign-in, as a rep.
        </p>
        <p className="mt-1">
          <strong>Turning access off:</strong> they can no longer sign in to the trainer. Their past calls are kept, and turning access back on
          restores everything.
        </p>
      </div>
    </div>
  );
}

