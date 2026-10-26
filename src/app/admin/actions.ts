"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/api/auth";
import { forgetProfileFlags, isFixedAdminEmail } from "@/lib/accessFlags";
import { requireAdmin } from "@/lib/team/access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";

// The Admin page's buttons. Every action checks again, on the server, what the person pressing it may do:
//   - owners (config/team.json -> owners) can make or remove admins, and change anyone except other owners;
//   - admins can make or remove managers and turn reps' and managers' access off or on, but can't touch admins;
//   - owners and admins set by email can never be changed here.

interface Target {
  id: string;
  email: string;
  role: string | null;
}

async function target(formData: FormData): Promise<Target> {
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/admin?error=bad");
  const { data } = await supabaseAdmin().from(TABLES.profiles).select("id, email, role").eq("id", id).maybeSingle();
  const row = data as Target | null;
  if (!row) redirect("/admin?error=missing");
  if (isFixedAdminEmail(row.email)) redirect("/admin?error=fixed");
  return row;
}

function done(id: string) {
  forgetProfileFlags(id);
  revalidatePath("/admin");
  revalidatePath("/team");
}

async function saveRole(person: Target, role: "rep" | "manager" | "admin", by: string | undefined) {
  const { error } = await supabaseAdmin().from(TABLES.profiles).update({ role }).eq("id", person.id);
  if (error) {
    console.error("admin: role change failed", error);
    // "admin" is refused until supabase/migrations/0003_trainer_admin_role.sql has been run.
    redirect(`/admin?error=${role === "admin" && /check|constraint/i.test(error.message) ? "migration-admin" : "save"}`);
  }
  console.log(`[admin] ${by} set ${person.email} to ${role}`);
  done(person.id);
}

/** Give someone manager access (Team pages and everyone's reports), or take it away. Admins can't change other admins. */
export async function setManager(formData: FormData) {
  const { user, access } = await requireAdmin();
  const person = await target(formData);
  if (person.role === "admin" && !access.isOwner) redirect("/admin?error=owner-only");
  await saveRole(person, formData.get("manager") === "true" ? "manager" : "rep", user.email);
}

/** Owners only: make someone an admin, or take admin away (they go back to rep; make them a manager again if needed). */
export async function setAdmin(formData: FormData) {
  const { user, access } = await requireAdmin();
  if (!access.isOwner) redirect("/admin?error=owner-only");
  const person = await target(formData);
  await saveRole(person, formData.get("admin") === "true" ? "admin" : "rep", user.email);
}

/** Turn someone's access to the trainer off or back on. Only owners can do this to an admin. */
export async function setAccess(formData: FormData) {
  const { user, access } = await requireAdmin();
  const person = await target(formData);
  if (person.id === user.id) redirect("/admin?error=self");
  if (person.role === "admin" && !access.isOwner) redirect("/admin?error=owner-only");
  const disabled = formData.get("disabled") === "true";
  const { error } = await supabaseAdmin().from(TABLES.profiles).update({ disabled }).eq("id", person.id);
  if (error) {
    console.error("admin: access change failed", error);
    redirect(`/admin?error=${/disabled/.test(error.message) ? "migration" : "save"}`);
  }
  console.log(`[admin] ${user.email} turned ${disabled ? "OFF" : "ON"} access for ${person.email}`);
  done(person.id);
}
