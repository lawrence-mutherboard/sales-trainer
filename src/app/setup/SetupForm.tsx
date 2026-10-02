"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SetupOptions } from "@/lib/config/public";

type Choice = { value: string; label: string; disabled?: boolean; sub?: string };

function Group({
  title,
  choices,
  value,
  onChange,
}: {
  title: string;
  choices: Choice[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => {
          const selected = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              disabled={c.disabled}
              onClick={() => onChange(c.value)}
              aria-pressed={selected}
              className={[
                "rounded-lg border px-4 py-2 text-left text-sm transition",
                selected ? "border-indigo-600 bg-indigo-50 text-indigo-900" : "border-slate-300 bg-white hover:border-slate-400",
                c.disabled ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              <span className="block font-medium">{c.label}</span>
              {c.sub && <span className="block text-xs text-slate-500">{c.sub}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SetupForm({ options }: { options: SetupOptions }) {
  const router = useRouter();
  const firstEnabled = options.scenarios.find((s) => s.enabled)?.value ?? options.scenarios[0].value;

  const [companySize, setCompanySize] = useState(options.sizes[0].value);
  const [department, setDepartment] = useState(options.departments[0].value);
  const [personality, setPersonality] = useState(options.personalities[0].value);
  const [scenario, setScenario] = useState(firstEnabled);
  const [difficulty, setDifficulty] = useState(options.difficulties[0].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedScenario = options.scenarios.find((s) => s.value === scenario);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_size: companySize, department, personality, scenario, difficulty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start the call");
      router.push(`/call/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the call");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <Group
        title="Scenario"
        value={scenario}
        onChange={setScenario}
        choices={options.scenarios.map((s) => ({
          value: s.value,
          label: s.label,
          disabled: !s.enabled,
          sub: s.enabled ? `${s.minutes} min` : "Coming soon",
        }))}
      />
      {selectedScenario && (
        <p className="-mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <strong>Goal:</strong> {selectedScenario.success} <span className="text-slate-500">— {selectedScenario.brief}</span>
        </p>
      )}
      <Group title="Company size" value={companySize} onChange={setCompanySize} choices={options.sizes} />
      <Group title="Department" value={department} onChange={setDepartment} choices={options.departments} />
      <Group title="Personality" value={personality} onChange={setPersonality} choices={options.personalities} />
      <Group title="Difficulty" value={difficulty} onChange={setDifficulty} choices={options.difficulties} />

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        onClick={start}
        disabled={busy}
        className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Finding a prospect…" : "Continue"}
      </button>
    </div>
  );
}
