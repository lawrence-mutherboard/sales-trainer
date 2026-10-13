import { z } from "zod";
import { NextResponse } from "next/server";
import { getOwnedSession, isUuid, requireUser } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";

export const runtime = "nodejs";

const Body = z.object({
  endedBy: z.enum(["rep", "prospect", "timeout"]),
  durationMs: z.number().int().min(0),
  // Speaking spans measured in the browser (the prospect's come from speech synthesis events).
  timings: z
    .array(z.object({ idx: z.number().int().min(0), startedMs: z.number().int().min(0), endedMs: z.number().int().min(0) }))
    .max(500),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const owned = await getOwnedSession(id, auth.user.id);
  if ("error" in owned) return owned.error;

  if (owned.session.status !== "ready" && owned.session.status !== "in_progress") {
    return NextResponse.json({ ok: true, alreadyEnded: true });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { endedBy, durationMs, timings } = parsed.data;

  const db = supabaseAdmin();
  await Promise.all(
    timings.map((t) =>
      db.from(TABLES.turns).update({ started_ms: t.startedMs, ended_ms: t.endedMs }).eq("session_id", id).eq("idx", t.idx),
    ),
  );

  const { error } = await db
    .from(TABLES.sessions)
    .update({ status: "ended", ended_by: endedBy, duration_ms: durationMs, ended_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("end: update failed", error);
    return NextResponse.json({ error: "Couldn't end the call" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
