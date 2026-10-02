"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginButton() {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Hint only - the domain is enforced on the server in /auth/callback and in the database.
        // "select_account" makes Google show its account picker every time, so people on a shared or already
        // signed-in browser choose their own account instead of being signed in as whoever Google remembers.
        queryParams: { hd: "mutherboard.com", prompt: "select_account" },
      },
    });
    if (error) setBusy(false);
  }

  return (
    <button
      onClick={signIn}
      disabled={busy}
      className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {busy ? "Redirecting…" : "Sign in with Google"}
    </button>
  );
}
