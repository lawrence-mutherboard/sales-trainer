import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CriterionResult, KeyMoment, ScoreResult, SessionRow, TurnRow } from "@/lib/types";
import { ReportView } from "./ReportView";
import { RetryScenarioButton } from "./RetryScenarioButton";
import { ScoreRetry } from "./ScoreRetry";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: sessionData } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
  if (!sessionData) notFound();
  const session = sessionData as unknown as SessionRow;

  if (session.status === "ready" || session.status === "in_progress") redirect(`/call/${id}`);

  const { data: scoreRow } = await supabase.from("scores").select("*").eq("session_id", id).maybeSingle();
  if (!scoreRow) {
    return <ScoreRetry sessionId={id} autoStart={session.status === "ended"} />;
  }
  const result = (scoreRow as unknown as { result_json: ScoreResult }).result_json;

  const { data: turnData } = await supabase.from("turns").select("*").eq("session_id", id).order("idx", { ascending: true });
  const turns = (turnData ?? []) as unknown as TurnRow[];

  // The rep's previous scored attempt at this scenario, for the "change vs last attempt" numbers.
  const { data: prevSession } = await supabase
    .from("sessions")
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
    const { data: prevScore } = await supabase
      .from("scores")
      .select("result_json")
      .eq("session_id", (prevSession as { id: string }).id)
      .maybeSingle();
    prev = (prevScore as unknown as { result_json: ScoreResult } | null)?.result_json ?? null;
  }

  return (
    <ReportView
      result={result}
      session={session}
      turns={turns}
      prev={prev}
      footer={
        <RetryScenarioButton
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
