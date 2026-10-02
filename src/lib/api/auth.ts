import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SessionRow } from "@/lib/types";

export function isAllowedEmail(email: string | undefined | null): boolean {
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "mutherboard.com").toLowerCase().replace(/^@/, "");
  return !!email && email.toLowerCase().endsWith(`@${domain}`);
}

/** Returns the signed-in user, or a 401/403 response to send straight back. */
export async function requireUser(): Promise<{ user: User } | { error: NextResponse }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!isAllowedEmail(user.email)) return { error: NextResponse.json({ error: "Account not allowed" }, { status: 403 }) };
  return { user };
}

/** Loads a session and checks it belongs to this user. Uses the service role, so ownership is checked here. */
export async function getOwnedSession(
  sessionId: string,
  userId: string,
): Promise<{ session: SessionRow } | { error: NextResponse }> {
  const { data, error } = await supabaseAdmin().from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error || !data) return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  const session = data as unknown as SessionRow;
  if (session.rep_id !== userId) return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  return { session };
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
