import { NextResponse } from "next/server";
import { z } from "zod";
import { DEPARTMENTS, DIFFICULTIES, PERSONALITIES, SIZES, config } from "@/lib/config";
import { ensureProfile, requireUser } from "@/lib/api/auth";
import { generateProspect } from "@/lib/profile/generate";
import { warmElevenLabs } from "@/lib/ai/elevenlabs";
import { isUuid } from "@/lib/api/auth";
import type { SessionRow, SessionSecrets } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";

const Body = z.object({
  company_size: z.enum(SIZES),
  department: z.enum(DEPARTMENTS),
  personality: z.enum(PERSONALITIES),
  scenario: z.string(),
  difficulty: z.enum(DIFFICULTIES),
});

// Company size, department, personality and difficulty can also be "random": like a real call to someone you don't know, the rep doesn't choose.
// The dice are rolled here on the server; the session stores the real values, so the prospect and the scoring work as usual.
const RandomBody = Body.extend({
  company_size: z.enum([...SIZES, "random"]),
  department: z.enum([...DEPARTMENTS, "random"]),
  personality: z.enum([...PERSONALITIES, "random"]),
  difficulty: z.enum([...DIFFICULTIES, "random"]),
});

function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// A rep can also practise the SAME prospect again (same person, company and hidden background): { repeat_of: <their earlier session id> }.
const Repeat = z.object({ repeat_of: z.string() });

// Creates a session, generates a fresh prospect + hidden profile, and keeps the profile on the server.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  await ensureProfile(auth.user);
  warmElevenLabs(); // load the voice list now, not on the first spoken line

  const raw = await req.json().catch(() => null);
  const repeat = Repeat.safeParse(raw);
  let b: z.infer<typeof Body>;
  let repeated: { name: string; title: string; company: string; secrets: SessionSecrets } | null = null;

  if (repeat.success) {
    if (!isUuid(repeat.data.repeat_of)) return NextResponse.json({ error: "Invalid call" }, { status: 400 });
    const adminDb = supabaseAdmin();
    const [origRes, secretRes] = await Promise.all([
      adminDb.from(TABLES.sessions).select("*").eq("id", repeat.data.repeat_of).maybeSingle(),
      adminDb.from(TABLES.secrets).select("hidden_profile").eq("session_id", repeat.data.repeat_of).maybeSingle(),
    ]);
    const orig = origRes.data as SessionRow | null;
    const secrets = (secretRes.data as { hidden_profile: SessionSecrets } | null)?.hidden_profile;
    if (!orig || orig.rep_id !== auth.user.id || !secrets) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    b = {
      company_size: orig.company_size as z.infer<typeof Body>["company_size"],
      department: orig.department as z.infer<typeof Body>["department"],
      personality: orig.personality as z.infer<typeof Body>["personality"],
      scenario: orig.scenario,
      difficulty: orig.difficulty as z.infer<typeof Body>["difficulty"],
    };
    repeated = { name: orig.prospect_name, title: orig.prospect_title, company: orig.prospect_company, secrets };
  } else {
    const parsed = RandomBody.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
    b = {
      ...parsed.data,
      company_size: parsed.data.company_size === "random" ? pickOne(SIZES) : parsed.data.company_size,
      department: parsed.data.department === "random" ? pickOne(DEPARTMENTS) : parsed.data.department,
      personality: parsed.data.personality === "random" ? pickOne(PERSONALITIES) : parsed.data.personality,
      difficulty: parsed.data.difficulty === "random" ? pickOne(DIFFICULTIES) : parsed.data.difficulty,
    };
  }

  const scenario = config.scenarios[b.scenario];
  if (!scenario) return NextResponse.json({ error: "Unknown scenario" }, { status: 400 });
  if (!scenario.enabled) return NextResponse.json({ error: "This scenario isn't available yet" }, { status: 400 });

  const prospect =
    repeated ??
    generateProspect({
      companySize: b.company_size,
      department: b.department,
      difficulty: b.difficulty,
      scenario: b.scenario,
    });

  const db = supabaseAdmin();
  const { data: session, error } = await db
    .from(TABLES.sessions)
    .insert({
      rep_id: auth.user.id,
      company_size: b.company_size,
      department: b.department,
      personality: b.personality,
      scenario: b.scenario,
      difficulty: b.difficulty,
      prospect_name: prospect.name,
      prospect_title: prospect.title,
      prospect_company: prospect.company,
    })
    .select("id")
    .single();
  if (error || !session) {
    console.error("start: insert session failed", error);
    return NextResponse.json({ error: "Couldn't create the session" }, { status: 500 });
  }

  const { error: secretError } = await db
    .from(TABLES.secrets)
    .insert({ session_id: (session as { id: string }).id, hidden_profile: prospect.secrets });
  if (secretError) {
    console.error("start: insert secrets failed", secretError);
    await db.from(TABLES.sessions).delete().eq("id", (session as { id: string }).id);
    return NextResponse.json({ error: "Couldn't create the session" }, { status: 500 });
  }

  return NextResponse.json({ id: (session as { id: string }).id });
}
