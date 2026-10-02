import { NextResponse } from "next/server";
import { z } from "zod";
import { DEPARTMENTS, DIFFICULTIES, PERSONALITIES, SIZES, config } from "@/lib/config";
import { requireUser } from "@/lib/api/auth";
import { generateProspect } from "@/lib/profile/generate";
import { supabaseAdmin } from "@/lib/supabase/admin";

const Body = z.object({
  company_size: z.enum(SIZES),
  department: z.enum(DEPARTMENTS),
  personality: z.enum(PERSONALITIES),
  scenario: z.string(),
  difficulty: z.enum(DIFFICULTIES),
});

// Creates a session, generates a fresh prospect + hidden profile, and keeps the profile on the server.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  const b = parsed.data;

  const scenario = config.scenarios[b.scenario];
  if (!scenario) return NextResponse.json({ error: "Unknown scenario" }, { status: 400 });
  if (!scenario.enabled) return NextResponse.json({ error: "This scenario isn't available yet" }, { status: 400 });

  const prospect = generateProspect({
    companySize: b.company_size,
    department: b.department,
    difficulty: b.difficulty,
    scenario: b.scenario,
  });

  const db = supabaseAdmin();
  const { data: session, error } = await db
    .from("sessions")
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
    .from("session_secrets")
    .insert({ session_id: (session as { id: string }).id, hidden_profile: prospect.secrets });
  if (secretError) {
    console.error("start: insert secrets failed", secretError);
    await db.from("sessions").delete().eq("id", (session as { id: string }).id);
    return NextResponse.json({ error: "Couldn't create the session" }, { status: 500 });
  }

  return NextResponse.json({ id: (session as { id: string }).id });
}
