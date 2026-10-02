"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Shown when a call has ended but has no score yet (still scoring, or scoring failed).
export function ScoreRetry({ sessionId, autoStart }: { sessionId: string; autoStart: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}/score`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Scoring failed. Please try again.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scoring failed. Please try again.");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto mt-10 max-w-md text-center">
      {busy ? (
        <>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <h1 className="mt-6 text-xl font-semibold">Scoring your call…</h1>
          <p className="mt-2 text-slate-600">This usually takes 20 to 40 seconds.</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Your call hasn&apos;t been scored yet</h1>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <p className="mt-2 text-slate-600">Your transcript is saved, so nothing is lost.</p>
          <button onClick={() => void run()} className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700">
            Score this call
          </button>
        </>
      )}
    </div>
  );
}
