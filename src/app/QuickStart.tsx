"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  value: string;
  label: string;
}

// One click to a realistic practice call: the scenario you pick, with a random company, department, personality and
// difficulty (rolled when the call is created), like a real call to someone you don't know.
export function QuickStart({
  scenarios,
  sizes,
  departments,
}: {
  scenarios: (Option & { minutes: number; brief: string })[];
  sizes: Option[];
  departments: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

  async function start(scenario: string) {
    setBusy(scenario);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario,
          company_size: pick(sizes).value,
          department: pick(departments).value,
          personality: "random",
          difficulty: "random",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start the call");
      router.push(`/call/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the call");
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {scenarios.map((s, i) => (
          <button
            key={s.value}
            onClick={() => void start(s.value)}
            disabled={busy !== null}
            className={[
              "rounded-xl border p-4 text-left shadow-sm transition disabled:opacity-60",
              i === 0 ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700" : "border-slate-200 bg-white hover:border-indigo-300",
            ].join(" ")}
          >
            <span className="flex items-center justify-between">
              <span className="text-lg font-semibold">{busy === s.value ? "Finding a prospect…" : s.label}</span>
              <span className={`text-xs ${i === 0 ? "text-indigo-100" : "text-slate-500"}`}>{s.minutes} min</span>
            </span>
            <span className={`mt-1 block text-sm ${i === 0 ? "text-indigo-100" : "text-slate-600"}`}>{s.brief}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
