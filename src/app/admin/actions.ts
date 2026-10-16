"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/api/auth";
import { forgetProfileFlags, isAdminEmail } from "@/lib/accessFlags";
import { requireAdmin } from "@/lib/team/access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";

// The Admin page's buttons. Every action checks again that the person pressing it is an admin, and admins themselves
// can't be changed here (they are set in config/team.json or ADMIN_EMAILS).

async function target(formData: FormData): Promise<{ id: string; email: string }> {
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/admin?error=bad");
  const { data } = await supabaseAdmin().from(TABLES.profiles).select("id, email").eq("id", id).maybeSingle();
  const row = data as { id: string; email: string } | null;
  if (!row) redirect("/admin?error=missing");
  if (isAdminEmail(row.email)) redirect("/admin?error=admin");
  return row;
}

function done(id: string) {
  forgetProfileFlags(id);
  revalidatePath("/admin");
  revalidatePath("/team");
}

/** Give someone manager access (Team pages and everyone's reports), or take it away. */
export async function setManager(formData: FormData) {
  const me = await requireAdmin();
  const person = await target(formData);
  const role = formData.get("manager") === "true" ? "manager" : "rep";
  const { error } = await supabaseAdmin().from(TABLES.profiles).update({ role }).eq("id", person.id);
  if (error) {
    console.error("admin: role change failed", error);
    redirect("/admin?error=save");
  }
  console.log(`[admin] ${me.email} set ${person.email} to ${role}`);
  done(person.id);
}

/** Turn someone's access to the trainer off or back on. Doesn't touch their sign-in for any other company app. */
export async function setAccess(formData: FormData) {
  const me = await requireAdmin();
  const person = await target(formData);
  if (person.id === me.id) redirect("/admin?error=self");
  const disabled = formData.get("disabled") === "true";
  const { error } = await supabaseAdmin().from(TABLES.profiles).update({ disabled }).eq("id", person.id);
  if (error) {
    console.error("admin: access change failed", error);
    // Most likely the "disabled" column hasn't been added yet.
    redirect(`/admin?error=${/disabled/.test(error.message) ? "migration" : "save"}`);
  }
  console.log(`[admin] ${me.email} turned ${disabled ? "OFF" : "ON"} access for ${person.email}`);
  done(person.id);
}
