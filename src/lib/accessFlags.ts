import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";
import { config } from "@/lib/config";

// A person's trainer-only settings, from trainer_profiles: their role ("rep" or "manager", set on the Admin page) and
// whether an admin has turned their access off. Kept in a separate small file (no page or cookie code) so the sign-in
// check that runs before every page can use it too. Cached for a minute per server, so it costs almost nothing.

/** Admins: config/team.json -> admins, or ADMIN_EMAILS (comma-separated) on the server. */
export function adminEmails(): string[] {
  const fromEnv = process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim()).filter(Boolean);
  return (fromEnv?.length ? fromEnv : config.team.admins).map((e) => e.toLowerCase());
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.toLowerCase());
}

/** True if an admin has turned this person's access off (admins themselves can never be locked out). */
export async function isLockedOut(user: { id: string; email?: string | null }): Promise<boolean> {
  if (isAdminEmail(user.email)) return false;
  return (await profileFlags(user.id)).disabled;
}

export interface ProfileFlags {
  role: string | null;
  disabled: boolean;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; flags: ProfileFlags }>();

export async function profileFlags(userId: string): Promise<ProfileFlags> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flags;
  // select("*") so this still works before the "disabled" column has been added (supabase/migrations/0002_trainer_access.sql).
  const { data, error } = await supabaseAdmin().from(TABLES.profiles).select("*").eq("id", userId).maybeSingle();
  if (error) {
    console.error("access: could not read the profile", error);
    return { role: null, disabled: false }; // don't lock everyone out because of a database hiccup
  }
  const row = data as { role?: string | null; disabled?: boolean | null } | null;
  const flags = { role: row?.role ?? null, disabled: Boolean(row?.disabled) };
  cache.set(userId, { at: Date.now(), flags });
  return flags;
}

/** Call after changing someone's role or access, so this server stops using the old values straight away. */
export function forgetProfileFlags(userId: string) {
  cache.delete(userId);
}
