import "server-only";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Managers are identified by email address: config/team.json, or MANAGER_EMAILS on the server (comma-separated), which
// takes precedence so the list can be changed on Render without a code change. Managers practise like anyone else; they
// can also open the Team pages and everyone's call reports.

export function managerEmails(): string[] {
  const fromEnv = process.env.MANAGER_EMAILS?.split(",").map((e) => e.trim()).filter(Boolean);
  return (fromEnv?.length ? fromEnv : config.team.managers).map((e) => e.toLowerCase());
}

export function isManager(email: string | null | undefined): boolean {
  return !!email && managerEmails().includes(email.toLowerCase());
}

/** For manager-only pages: the signed-in manager, or the page is sent to sign-in (not signed in) or a 404 (not a manager). */
export async function requireManager(): Promise<User> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // A 404 rather than "forbidden", so the page doesn't advertise itself to people who can't use it.
  if (!isManager(user.email)) notFound();
  return user;
}
