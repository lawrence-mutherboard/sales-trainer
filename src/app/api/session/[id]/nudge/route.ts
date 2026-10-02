import { z } from "zod";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { isUuid, requireUser } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SessionRow, TurnRow } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().trim().min(1).max(200) });

// Saves one of the prospect's "are you still there?" lines (see config/silence.json) as a turn in the transcript.
// Only the lines in that file are accepted, so this can't be used to put arbitrary words in the prospect's mouth.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const allowed = new Set([...config.silence.lines.first, ...config.silence.lines.second, ...config.silence.lines.hangup]);
  if (!allowed.has(parsed.data.text)) return NextResponse.json({ error: "Not an allowed line" }, { status: 400 });

  const db = supabaseAdmin();
  const [sessionRes, lastRes] = await Promise.all([
    db.from("sessions").select("id, rep_id, status").eq("id", id).maybeSingle(),
    db.from("turns").select("idx, speaker").eq("session_id", id).order("idx", { ascending: false }).limit(1),
  ]);
  const session = sessionRes.data as Pick<SessionRow, "id" | "rep_id" | "status"> | null;
  if (!session || session.rep_id !== auth.user.id) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.status !== "in_progress" && session.status !== "ready") {
    return NextResponse.json({ error: "This call has ended" }, { status: 409 });
  }

  const last = ((lastRes.data ?? []) as Pick<TurnRow, "idx" | "speaker">[])[0];
  // Only the prospect can be "waiting for the rep". If the rep spoke last, a real reply is due instead.
  if (last && last.speaker !== "prospect") return NextResponse.json({ error: "Not waiting for the rep" }, { status: 409 });

  const idx = last ? last.idx + 1 : 0;
  const { error } = await db.from("turns").insert({ session_id: id, idx, speaker: "prospect", text: parsed.data.text });
  if (error) {
    console.error("nudge: insert failed", error);
    return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  }
  return NextResponse.json({ idx });
}
