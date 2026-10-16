import "server-only";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { adminEmails, isAdminEmail, profileFlags } from "@/lib/accessFlags";

export { adminEmails, isAdminEmail };

// Who can do what.
//   Admin:   listed in config/team.json -> admins (or ADMIN_EMAILS on the server). Can use the Admin page. Always a manager.
//   Manager: listed in config/team.json -> managers (or MANAGER_EMAILS), or given the manager role on the Admin page.
//            Can see the Team pages and anyone's call reports.
//   Everyone practises the same way.

function emailList(envValue: string | undefined, fallback: string[]): string[] {
  const fromEnv = envValue?.split(",").map((e) => e.trim()).filter(Boolean);
  return (fromEnv?.length ? fromEnv : fallback).map((e) => e.toLowerCase());
}

/** On the managers email list (config/team.json -> managers, or MANAGER_EMAILS). Their role can't be changed on the Admin page. */
export function isListedManager(email: string | null | undefined): boolean {
  return !!email && emailList(process.env.MANAGER_EMAILS, config.team.managers).includes(email.toLowerCase());
}

/** Managers by email (config or MANAGER_EMAILS), including admins. Doesn't include people made managers on the Admin page. */
export function isConfiguredManager(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return isAdminEmail(e) || isListedManager(e);
}

export interface Access {
  isAdmin: boolean;
  isManager: boolean;
  disabled: boolean;
}

export async function accessFor(user: Pick<User, "id" | "email"> | null | undefined): Promise<Access> {
  if (!user) return { isAdmin: false, isManager: false, disabled: false };
  const isAdmin = isAdminEmail(user.email);
  const flags = await profileFlags(user.id);
  return {
    isAdmin,
    isManager: isAdmin || isConfiguredManager(user.email) || flags.role === "manager",
    disabled: !isAdmin && flags.disabled, // an admin can never lock themselves out
  };
}

async function signedInUser(): Promise<User> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/** For manager-only pages. A 404 for everyone else, so the page doesn't advertise itself. */
export async function requireManager(): Promise<User> {
  const user = await signedInUser();
  const access = await accessFor(user);
  if (!access.isManager || access.disabled) notFound();
  return user;
}

/** For the Admin page and its actions. */
export async function requireAdmin(): Promise<User> {
  const user = await signedInUser();
  if (!isAdminEmail(user.email)) notFound();
  return user;
}
