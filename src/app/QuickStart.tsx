"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  value: string;
  label: string;
}

// One click to a practice call: the scenario you pick, with a random company and department. Personality and difficulty
// default to Random (rolled when the call is created, like a real call to someone you don't know), but can be chosen here.
export function QuickStart({
  scenarios,
  sizes,
  departments,
  personalities,
  difficulties,
}: {
  scenarios: (Option & { minutes: number; brief: string })[];
  sizes: Option[];
  departments: Option[];
  personalities: Option[];
  difficulties: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personality, setPersonality] = useState("random");
  const [difficulty, setDifficulty] = useState("random");
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

  async function start(scenario: string) {
    setBusy(scenario);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, company_size: pick(sizes).value, department: pick(departments).value, personality, difficulty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start the call");
      router.push(`/call/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the call");
      setBusy(null);
    }
  }

  const Choice = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) => (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {[{ value: "random", label: "🎲 Random" }, ...options].map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={[
              "rounded-full border px-3 py-1 text-sm transition",
              value === o.value
                ? "border-indigo-600 bg-indigo-600 text-white"
                : o.value === "random"
                  ? "border-dashed border-indigo-400 bg-indigo-50 text-indigo-900 hover:bg-indigo-100"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
            ].join(" ")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div>
      <div className="mb-4 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <Choice label="Prospect's personality" value={personality} onChange={setPersonality} options={personalities} />
        <Choice label="Difficulty" value={difficulty} onChange={setDifficulty} options={difficulties} />
      </div>
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
