import { z } from "zod";
import { NextResponse } from "next/server";
import { config, getScenario } from "@/lib/config";
import { isUuid, requireUser } from "@/lib/api/auth";
import { getProvider } from "@/lib/ai/provider";
import { buildClockNote, buildGlobalPrompt, buildSessionPrompt } from "@/lib/ai/prospectPrompt";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { END_CALL_MARKER, type SessionRow, type SessionSecrets, type TurnRow } from "@/lib/types";
import { TABLES } from "@/lib/db/tables";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  repText: z.string().trim().min(1).max(4000).optional(),
  startedMs: z.number().int().min(0).optional(),
  endedMs: z.number().int().min(0).optional(),
  nowMs: z.number().int().min(0),
  inputMode: z.enum(["voice", "typed"]).optional(),
});

const OPENING_MARKER = "[The call connects. Nobody has spoken yet.]";

type Msg = { role: "user" | "assistant"; content: string };

/** Turns -> alternating messages. The first message is always a user message (the call connecting). */
function toMessages(turns: TurnRow[]): Msg[] {
  const out: Msg[] = [{ role: "user", content: OPENING_MARKER }];
  for (const t of turns) {
    const role = t.speaker === "rep" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last.role === role) last.content += `\n${t.text}`;
    else out.push({ role, content: t.text });
  }
  return out;
}

// The hidden profile never changes during a call, so remember it instead of re-reading it every turn.
const secretsCache = new Map<string, SessionSecrets>();
function rememberSecrets(id: string, secrets: SessionSecrets) {
  if (secretsCache.size > 200) secretsCache.delete(secretsCache.keys().next().value as string);
  secretsCache.set(id, secrets);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const db = supabaseAdmin();

  // Everything we need is fetched at the same time, to keep the wait before the AI starts as short as possible.
  const cachedSecrets = secretsCache.get(id);
  const [bodyRaw, sessionRes, turnRes, secretRes] = await Promise.all([
    req.json().catch(() => null),
    db.from(TABLES.sessions).select("*").eq("id", id).maybeSingle(),
    db.from(TABLES.turns).select("*").eq("session_id", id).order("idx", { ascending: true }),
    cachedSecrets
      ? Promise.resolve({ data: { hidden_profile: cachedSecrets } })
      : db.from(TABLES.secrets).select("hidden_profile").eq("session_id", id).maybeSingle(),
  ]);

  const session = sessionRes.data as unknown as SessionRow | null;
  if (!session || session.rep_id !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "ended" || session.status === "scored" || session.status === "score_failed") {
    return NextResponse.json({ error: "This call has ended" }, { status: 409 });
  }

  const parsed = Body.safeParse(bodyRaw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;

  const scenario = getScenario(session.scenario);
  if (!scenario) return NextResponse.json({ error: "Unknown scenario" }, { status: 500 });

  const turns = (turnRes.data ?? []) as unknown as TurnRow[];
  const secrets = (secretRes.data as { hidden_profile: SessionSecrets } | null)?.hidden_profile;
  if (!secrets) return NextResponse.json({ error: "Session data missing" }, { status: 500 });
  rememberSecrets(id, secrets);

  // ---- Decide what this request is: the opening, a normal rep turn, or a retry of the last rep turn ----
  const last = turns[turns.length - 1];
  let repTurns = turns;
  let saveRepTurn: Promise<{ error: unknown }> | null = null;

  if (body.repText) {
    // Save the rep's turn in the background while the AI is already working on the reply.
    const row = {
      session_id: id,
      idx: turns.length,
      speaker: "rep" as const,
      text: body.repText,
      started_ms: body.startedMs ?? null,
      ended_ms: body.endedMs ?? null,
    };
    saveRepTurn = Promise.resolve(db.from(TABLES.turns).insert(row)).then((r) => ({ error: r.error }));
    repTurns = [...turns, { id: "pending", ...row } as TurnRow];
  } else if (turns.length === 0) {
    // Opening: the prospect answers the call first.
  } else if (last.speaker !== "rep") {
    return NextResponse.json({ error: "Nothing to respond to" }, { status: 409 });
  }
  // (else: retry after a failed reply - the last rep turn is already saved)

  if (session.status === "ready" || (body.inputMode && body.inputMode !== session.input_mode)) {
    void Promise.resolve(
      db
        .from(TABLES.sessions)
        .update({ status: "in_progress", ...(body.inputMode ? { input_mode: body.inputMode } : {}) })
        .eq("id", id),
    ).catch((e) => console.error("turn: status update failed", e));
  }

  // ---- Build the request ----
  const messages = toMessages(repTurns);
  const lastRep = [...repTurns].reverse().find((t) => t.speaker === "rep");
  const lastRepDuration =
    lastRep && lastRep.started_ms != null && lastRep.ended_ms != null ? lastRep.ended_ms - lastRep.started_ms : null;
  const clock = buildClockNote({
    elapsedMs: body.nowMs,
    limitMs: scenario.time_limit_min * 60_000,
    lastRepTurnMs: repTurns[repTurns.length - 1]?.speaker === "rep" ? lastRepDuration : null,
    prospectName: session.prospect_name,
  });
  const globalPrompt = buildGlobalPrompt();
  const sessionPrompt = buildSessionPrompt(session, secrets);
  const provider = getProvider();

  // ---- Stream the reply back as NDJSON events ----
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      // repSaved tells the browser whether a retry should resend the rep's words.
      const fail = (message: string, repSaved: boolean) => send({ t: "error", message, retryable: true, repSaved });
      try {
        let full = "";
        let sent = 0;
        const holdback = END_CALL_MARKER.length; // never emit a possible partial hang-up marker

        const feed = (delta: string) => {
          full += delta;
          const safeUpTo = Math.max(sent, full.length - holdback);
          if (safeUpTo > sent) {
            send({ t: "delta", text: full.slice(sent, safeUpTo) });
            sent = safeUpTo;
          }
        };

        // Replies start with a mood tag like "{impatient}". It controls the voice and is never shown, spoken or saved.
        let moodResolved = false;
        let head = "";
        const onText = (delta: string) => {
          if (moodResolved) return feed(delta);
          head += delta;
          const t = head.trimStart();
          if (!t) return;
          if (!t.startsWith("{")) {
            moodResolved = true;
            return feed(head);
          }
          const close = t.indexOf("}");
          if (close === -1) {
            if (t.length > 30) {
              moodResolved = true; // not a real tag after all
              feed(head);
            }
            return;
          }
          const mood = t.slice(1, close).trim().toLowerCase();
          moodResolved = true;
          send({ t: "mood", mood: config.ai.tts.moods[mood] ? mood : null });
          feed(t.slice(close + 1).trimStart());
        };

        const result = await provider.streamProspect({
          globalPrompt,
          sessionPrompt,
          messages,
          privateNote: clock,
          onText,
        });
        if (!moodResolved && head) {
          moodResolved = true;
          feed(head);
        }

        const repSave = saveRepTurn ? await saveRepTurn : null;
        if (repSave?.error) {
          console.error("turn: insert rep turn failed", repSave.error);
          fail("Couldn't save your turn. Please try again.", false);
          return;
        }

        if (result.refused) {
          fail("The prospect couldn't respond to that. Please try again.", true);
          return;
        }

        const endCall = full.includes(END_CALL_MARKER);
        const clean = full.replace(END_CALL_MARKER, "").trim();
        if (!clean) {
          fail("The prospect didn't reply. Please try again.", true);
          return;
        }
        // Flush whatever was held back (minus the marker).
        const remainder = full.replace(END_CALL_MARKER, "").slice(sent);
        if (remainder) send({ t: "delta", text: remainder });

        const { data: saved, error } = await db
          .from(TABLES.turns)
          .insert({ session_id: id, idx: repTurns.length, speaker: "prospect", text: clean })
          .select("id")
          .single();
        if (error || !saved) {
          console.error("turn: insert prospect turn failed", error);
          fail("Couldn't save the reply. Please try again.", true);
          return;
        }

        send({ t: "done", turnId: (saved as { id: string }).id, idx: repTurns.length, endCall });
      } catch (err) {
        console.error("turn: stream failed", err);
        const repSaved = saveRepTurn ? !(await saveRepTurn.catch(() => ({ error: true }))).error : true;
        fail("Connection problem. Please try again.", repSaved);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
