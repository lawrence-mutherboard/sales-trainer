"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// "Retry this scenario": same settings, brand-new prospect. "Same prospect again": the same person and hidden background,
// so the rep can see how much better they do on exactly the same call.
export function RetryScenarioButton({
  sessionId,
  settings,
}: {
  sessionId: string;
  settings: { company_size: string; department: string; personality: string; scenario: string; difficulty: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"new" | "same" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(kind: "new" | "same") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "same" ? { repeat_of: sessionId } : settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start a new call");
      router.push(`/call/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a new call");
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => void start("same")}
          disabled={busy !== null}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy === "same" ? "Setting up the same prospect…" : "Practise this prospect again"}
        </button>
        <button
          onClick={() => void start("new")}
          disabled={busy !== null}
          className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "new" ? "Finding a new prospect…" : "Try a new prospect"}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-500">Same prospect = same person and the same hidden background, to see how much you improved.</p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
