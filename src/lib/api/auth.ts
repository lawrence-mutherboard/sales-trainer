import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SessionRow } from "@/lib/types";
import { TABLES } from "@/lib/db/tables";
import { isAllowedEmail, isAllowedUser } from "@/lib/authDomain";

export { isAllowedEmail };

/** Returns the signed-in user, or a 401/403 response to send straight back. */
export async function requireUser(): Promise<{ user: User } | { error: NextResponse }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!isAllowedUser(user)) return { error: NextResponse.json({ error: "Account not allowed" }, { status: 403 }) };
  return { user };
}

/** Loads a session and checks it belongs to this user. Uses the service role, so ownership is checked here. */
export async function getOwnedSession(
  sessionId: string,
  userId: string,
): Promise<{ session: SessionRow } | { error: NextResponse }> {
  const { data, error } = await supabaseAdmin().from(TABLES.sessions).select("*").eq("id", sessionId).maybeSingle();
  if (error || !data) return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  const session = data as unknown as SessionRow;
  if (session.rep_id !== userId) return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  return { session };
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Makes sure the signed-in person has a row in the trainer's own profiles table. Done by the app on sign-in (and before
 * a call starts) instead of a database trigger, so the app never has to touch the shared sign-in table.
 */
export async function ensureProfile(user: User): Promise<void> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  const { error } = await supabaseAdmin()
    .from(TABLES.profiles)
    .upsert({ id: user.id, email: (user.email ?? "").toLowerCase(), name }, { onConflict: "id", ignoreDuplicates: true });
  if (error) console.error("ensureProfile failed", error);
}
