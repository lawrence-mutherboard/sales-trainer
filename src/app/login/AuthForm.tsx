"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Mode = "signin" | "signup" | "forgot";

const DOMAIN = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "mutherboard.com").replace(/^@/, "").toLowerCase();
const MIN_PASSWORD = 10;

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Wrong email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox (and spam) for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) return "That email already has an account. Sign in instead, or use Forgot password.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("password") && (m.includes("characters") || m.includes("weak") || m.includes("short")))
    return `Your password needs at least ${MIN_PASSWORD} characters.`;
  return message;
}

/** `signOutFirst` is set when the page was reached because a signed-in account was refused (wrong domain / unconfirmed). */
export function AuthForm({ signOutFirst = false }: { signOutFirst?: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // A refused account would otherwise stay signed in and bounce back here on every page.
  useEffect(() => {
    if (signOutFirst) void createSupabaseBrowserClient().auth.signOut();
  }, [signOutFirst]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.endsWith(`@${DOMAIN}`)) {
      setError(`Use your @${DOMAIN} work email.`);
      return;
    }
    if (mode === "signup" && password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const origin = window.location.origin;

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        window.location.assign("/setup"); // a full load, so the server sees the new sign-in straight away
        return;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: name.trim() || undefined },
            emailRedirectTo: `${origin}/auth/callback`,
          },
        });
        if (error) throw error;
        // If the project doesn't require email confirmation a session starts immediately. The app refuses
        // unconfirmed accounts anyway, so this message is right either way.
        void data;
        setInfo("Check your inbox for a confirmation link, then come back here and sign in.");
        setMode("signin");
        setPassword("");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${origin}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setInfo("If that address has an account, a password reset link is on its way.");
        setMode("signin");
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password";
  const cta = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link";

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>

      {mode === "signup" && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Work email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder={`you@${DOMAIN}`}
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>

      {mode !== "forgot" && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          {mode === "signup" && <span className="mt-1 block text-xs text-slate-500">At least {MIN_PASSWORD} characters.</span>}
        </label>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {info && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Please wait…" : cta}
      </button>

      <div className="flex flex-wrap justify-between gap-2 text-sm text-indigo-700">
        {mode === "signin" ? (
          <>
            <button type="button" onClick={() => switchMode("signup")} className="hover:underline">
              Create an account
            </button>
            <button type="button" onClick={() => switchMode("forgot")} className="hover:underline">
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchMode("signin")} className="hover:underline">
            Back to sign in
          </button>
        )}
      </div>
    </form>
  );
}
