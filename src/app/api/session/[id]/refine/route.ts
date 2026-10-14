import { z } from "zod";
import { NextResponse } from "next/server";
import { getOwnedSession, isUuid, requireUser } from "@/lib/api/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { plausibleTranscript } from "@/lib/voice/audio";
import { TABLES } from "@/lib/db/tables";
import type { TurnRow } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({ original: z.string().trim().min(1).max(3000), better: z.string().trim().min(1).max(3000) });

// The call carries on with the browser's text straight away. A few seconds later the accurate transcript of the same words
// (punctuated, with filler words) is ready, and this replaces the browser's version in the saved transcript, so the
// report, the scorer and the filler-word count use the accurate one. Only the rep's own lines can be changed, and only
// before the call has been scored.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const owned = await getOwnedSession(id, auth.user.id);
  if ("error" in owned) return owned.error;
  if (owned.session.status === "scored") return NextResponse.json({ ok: true, tooLate: true });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { original, better } = parsed.data;
  if (!plausibleTranscript(better, original)) return NextResponse.json({ error: "Not a plausible transcript" }, { status: 422 });

  const db = supabaseAdmin();
  const { data } = await db
    .from(TABLES.turns)
    .select("id, text")
    .eq("session_id", id)
    .eq("speaker", "rep")
    .order("idx", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as Pick<TurnRow, "id" | "text">[];
  // The most recent rep line that contains these words (two quick sentences can be saved together as one line).
  const row = rows.find((r) => r.text.includes(original));
  if (!row) return NextResponse.json({ error: "Turn not found" }, { status: 404 });

  const { error } = await db.from(TABLES.turns).update({ text: row.text.replace(original, () => better) }).eq("id", row.id);
  if (error) {
    console.error("refine: update failed", error);
    return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
