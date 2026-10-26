import "server-only";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isFixedAdminEmail, isOwnerEmail, profileFlags } from "@/lib/accessFlags";

export { isFixedAdminEmail, isOwnerEmail };

// Who can do what.
//   Owner:   config/team.json -> owners (or OWNER_EMAILS). Everything an admin can do, plus make or remove admins.
//            Can't be changed or locked out from the app.
//   Admin:   made by an owner on the Admin page (or listed in config/team.json -> admins). Uses the Admin page to make
//            people managers and turn reps' and managers' access off or on. Can't make admins or change other admins.
//   Manager: config/team.json -> managers (or MANAGER_EMAILS), or made a manager on the Admin page. Sees the Team pages
//            and everyone's call reports.
//   Everyone practises the same way.

function emailList(envValue: string | undefined, fallback: string[]): string[] {
  const fromEnv = envValue?.split(",").map((e) => e.trim()).filter(Boolean);
  return (fromEnv?.length ? fromEnv : fallback).map((e) => e.toLowerCase());
}

/** On the managers email list (config/team.json -> managers, or MANAGER_EMAILS). Their role can't be changed on the Admin page. */
export function isListedManager(email: string | null | undefined): boolean {
  return !!email && emailList(process.env.MANAGER_EMAILS, config.team.managers).includes(email.toLowerCase());
}

export interface Access {
  isOwner: boolean;
  isAdmin: boolean;
  isManager: boolean;
  disabled: boolean;
}

export async function accessFor(user: Pick<User, "id" | "email"> | null | undefined): Promise<Access> {
  if (!user) return { isOwner: false, isAdmin: false, isManager: false, disabled: false };
  const isOwner = isOwnerEmail(user.email);
  const fixed = isFixedAdminEmail(user.email);
  const flags = await profileFlags(user.id);
  const isAdmin = fixed || flags.role === "admin";
  return {
    isOwner,
    isAdmin,
    isManager: isAdmin || isListedManager(user.email) || flags.role === "manager",
    disabled: !fixed && flags.disabled, // owners and admins set by email can never be locked out
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

/** For the Admin page and its actions: the signed-in admin (or owner) and what they may do. A 404 for everyone else. */
export async function requireAdmin(): Promise<{ user: User; access: Access }> {
  const user = await signedInUser();
  const access = await accessFor(user);
  if (!access.isAdmin || access.disabled) notFound();
  return { user, access };
}
