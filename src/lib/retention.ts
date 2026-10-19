import "server-only";
import { config } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TABLES } from "@/lib/db/tables";

// Keeps the promise made on the sign-in page: calls are kept for config/business.json -> retention_days (90) and then
// deleted. Deleting a call removes its transcript, score and hidden prospect details with it (the tables cascade).
// Runs from the app itself, at most every six hours per server, when someone starts a call, so it needs no scheduler
// and no change to the shared Supabase project.

const EVERY_MS = 6 * 60 * 60 * 1000;
let lastRun = 0;

export function retentionCutoff(now = Date.now()): string {
  return new Date(now - config.business.retention_days * 86_400_000).toISOString();
}

/** Deletes calls older than the retention period. Returns how many were deleted. */
export async function deleteOldCalls(): Promise<number> {
  const { error, count } = await supabaseAdmin().from(TABLES.sessions).delete({ count: "exact" }).lt("started_at", retentionCutoff());
  if (error) throw error;
  if (count) console.log(`[retention] deleted ${count} call(s) older than ${config.business.retention_days} days`);
  return count ?? 0;
}

/** Fire-and-forget: runs the clean-up if it hasn't run on this server in the last six hours. Never slows the caller. */
export function cleanUpOldCallsSoon() {
  if (Date.now() - lastRun < EVERY_MS) return;
  lastRun = Date.now();
  void deleteOldCalls().catch((err) => {
    lastRun = 0; // try again next time
    console.error("[retention] clean-up failed", err);
  });
}
