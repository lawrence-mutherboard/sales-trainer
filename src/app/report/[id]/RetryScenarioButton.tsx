"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// "Retry this scenario": same settings, brand-new prospect.
export function RetryScenarioButton({
  settings,
}: {
  settings: { company_size: string; department: string; personality: string; scenario: string; difficulty: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start a new call");
      router.push(`/call/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a new call");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => void retry()}
        disabled={busy}
        className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Finding a new prospect…" : "Retry this scenario"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
