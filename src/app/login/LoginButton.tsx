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
        queryParams: { hd: "mutherboard.com" },
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
