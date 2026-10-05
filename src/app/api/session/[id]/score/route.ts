import { NextResponse } from "next/server";
import { getOwnedSession, isUuid, requireUser } from "@/lib/api/auth";
import { RefusalError } from "@/lib/ai/provider";
import { scoreSession } from "@/lib/ai/scorer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SessionSecrets, TurnRow } from "@/lib/types";
import { TABLES } from "@/lib/db/tables";

export const runtime = "nodejs";
export const maxDuration = 300;

// Scores a finished call. Safe to call again after a failure (the report page has a "retry scoring" button).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const owned = await getOwnedSession(id, auth.user.id);
  if ("error" in owned) return owned.error;
  const { session } = owned;

  if (session.status === "scored") return NextResponse.json({ ok: true, alreadyScored: true });
  if (session.status !== "ended" && session.status !== "score_failed") {
    return NextResponse.json({ error: "The call hasn't ended yet" }, { status: 409 });
  }

  const db = supabaseAdmin();
  const [{ data: turnData }, { data: secretData }] = await Promise.all([
    db.from(TABLES.turns).select("*").eq("session_id", id).order("idx", { ascending: true }),
    db.from(TABLES.secrets).select("hidden_profile").eq("session_id", id).maybeSingle(),
  ]);
  const turns = (turnData ?? []) as unknown as TurnRow[];
  const secrets = (secretData as { hidden_profile: SessionSecrets } | null)?.hidden_profile;
  if (!secrets) return NextResponse.json({ error: "Session data missing" }, { status: 500 });

  if (!turns.some((t) => t.speaker === "rep")) {
    return NextResponse.json({ error: "The call was too short to score - you didn't say anything." }, { status: 422 });
  }

  try {
    const { result, model } = await scoreSession({ session, turns, secrets });
    const { error } = await db
      .from(TABLES.scores)
      .upsert(
        { session_id: id, total: result.total, pass: result.pass, result_json: result, model },
        { onConflict: "session_id" },
      );
    if (error) throw error;
    await db.from(TABLES.sessions).update({ status: "scored" }).eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("score: failed", err);
    await db.from(TABLES.sessions).update({ status: "score_failed" }).eq("id", id);
    const message =
      err instanceof RefusalError
        ? "The scorer declined to process this transcript. Try scoring again."
        : "Scoring failed. Your transcript is saved - try scoring again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
