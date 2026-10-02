import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. BYPASSES row-level security. Server only - never import from a client component.
// Used for writing sessions/turns/scores and for reading session_secrets (the hidden prospect profile).
// Untyped on purpose (no generated Database types), so table rows are `any` and the routes cast them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, "public", any>;

let admin: AdminClient | null = null;

export function supabaseAdmin(): AdminClient {
  admin ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
