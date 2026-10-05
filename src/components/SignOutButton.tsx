"use client";

import { useState } from "react";

// Signs out, and covers the page with a "Signing you out" screen while it happens, so it's clear something is going on
// (on a slow connection the sign-out can take a moment).
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    const minimumShown = new Promise((resolve) => setTimeout(resolve, 600)); // avoid a one-frame flash
    try {
      await fetch("/auth/signout", { method: "POST" });
    } catch {
      /* even if this fails, the login page will ask them to sign in again if their session has ended */
    }
    await minimumShown;
    window.location.assign("/login"); // a full page load, so nothing from the old session is left in memory
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        Sign out
      </button>

      {busy && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/95 backdrop-blur-sm"
        >
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="mt-6 text-xl font-semibold text-slate-900">Signing you out…</p>
          <p className="mt-2 text-sm text-slate-500">You&apos;ll be taken back to the sign-in page.</p>
        </div>
      )}
    </>
  );
}
