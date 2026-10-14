import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ScoreResult, SessionRow, TurnRow } from "@/lib/types";
import { ReportView } from "./ReportView";
import { RetryScenarioButton } from "./RetryScenarioButton";
import { ScoreRetry } from "./ScoreRetry";
import { TABLES } from "@/lib/db/tables";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isManager } from "@/lib/team/access";
import { displayName } from "@/lib/team/stats";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Reps see their own calls (row-level security). A manager can also open anyone's call: if it isn't theirs, it is read
  // with the service role, after checking they are on the managers list.
  let db = supabase;
  let viewing: { name: string; repId: string } | null = null;
  let { data: sessionData, error: sessionError } = await supabase.from(TABLES.sessions).select("*").eq("id", id).maybeSingle();
  if (!sessionData) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (isManager(user?.email)) {
      db = supabaseAdmin() as unknown as typeof supabase;
      ({ data: sessionData, error: sessionError } = await db.from(TABLES.sessions).select("*").eq("id", id).maybeSingle());
      if (sessionData) {
        const repId = (sessionData as unknown as SessionRow).rep_id;
        const { data: prof } = await db.from(TABLES.profiles).select("email, name").eq("id", repId).maybeSingle();
        const pr = prof as { email: string; name: string | null } | null;
        viewing = { name: pr ? displayName(pr.email, pr.name) : "this person", repId };
      }
    }
  }
  if (sessionError) console.error(`report page: could not read the session from the database: ${sessionError.message} (code ${sessionError.code}). If this says "permission denied", the table needs the grants in supabase/grants.sql.`);
  if (!sessionData) notFound();
  const session = sessionData as unknown as SessionRow;

  if (viewing && (session.status === "ready" || session.status === "in_progress")) {
    return <ManagerNote viewing={viewing} text="This call hasn't finished yet, so there is no report." />;
  }
  if (session.status === "ready" || session.status === "in_progress") redirect(`/call/${id}`);

  const { data: scoreRow } = await db.from(TABLES.scores).select("*").eq("session_id", id).maybeSingle();
  if (!scoreRow) {
    if (viewing) return <ManagerNote viewing={viewing} text="This call hasn't been scored yet. It is scored when the person opens their report." />;
    return <ScoreRetry sessionId={id} autoStart={session.status === "ended"} />;
  }
  const result = (scoreRow as unknown as { result_json: ScoreResult }).result_json;

  const { data: turnData } = await db.from(TABLES.turns).select("*").eq("session_id", id).order("idx", { ascending: true });
  const turns = (turnData ?? []) as unknown as TurnRow[];

  // The rep's previous scored attempt at this scenario, for the "change vs last attempt" numbers.
  const { data: prevSession } = await db
    .from(TABLES.sessions)
    .select("id")
    .eq("rep_id", session.rep_id)
    .eq("scenario", session.scenario)
    .eq("status", "scored")
    .lt("started_at", session.started_at)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let prev: ScoreResult | null = null;
  if (prevSession) {
    const { data: prevScore } = await db
      .from(TABLES.scores)
      .select("result_json")
      .eq("session_id", (prevSession as { id: string }).id)
      .maybeSingle();
    prev = (prevScore as unknown as { result_json: ScoreResult } | null)?.result_json ?? null;
  }

  if (viewing) {
    return (
      <>
        <ManagerNote viewing={viewing} />
        <ReportView result={result} session={session} turns={turns} prev={prev} footer={null} />
      </>
    );
  }

  return (
    <ReportView
      result={result}
      session={session}
      turns={turns}
      prev={prev}
      footer={
        <RetryScenarioButton
          sessionId={session.id}
          settings={{
            company_size: session.company_size,
            department: session.department,
            personality: session.personality,
            scenario: session.scenario,
            difficulty: session.difficulty,
          }}
        />
      }
    />
  );
}

/** Shown when a manager is looking at someone else's call. */
function ManagerNote({ viewing, text }: { viewing: { name: string; repId: string }; text?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
      <span>
        Manager view: <strong>{viewing.name}</strong>&apos;s call. {text}
      </span>
      <Link href={`/team/${viewing.repId}`} className="font-medium text-indigo-700 hover:underline">
        See all of {viewing.name.split(" ")[0]}&apos;s calls →
      </Link>
    </div>
  );
}
