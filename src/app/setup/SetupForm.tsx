"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SetupOptions } from "@/lib/config/public";

type Choice = { value: string; label: string; sub?: string; disabled?: boolean; special?: boolean };

// "Random" is rolled on the server when the call is created, so the rep doesn't know who they're getting,
// like a real call to someone they have never spoken to.
const RANDOM: Choice = { value: "random", label: "Random", sub: "Like a real call", special: true };

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{step}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {hint && <p className="text-sm text-slate-500">{hint}</p>}
          <div className="mt-3 space-y-5">{children}</div>
        </div>
      </div>
    </section>
  );
}

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
                c.special
                  ? selected
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                    : "border-dashed border-indigo-400 bg-indigo-50/60 text-indigo-900 hover:bg-indigo-50"
                  : selected
                    ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                    : "border-slate-300 bg-white hover:border-slate-400",
                c.disabled ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              <span className="block font-medium">
                {c.special && <span aria-hidden="true">🎲 </span>}
                {c.label}
              </span>
              {c.sub && <span className={`block text-xs ${c.special && selected ? "text-indigo-100" : "text-slate-500"}`}>{c.sub}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SetupForm({ options, initialScenario }: { options: SetupOptions; initialScenario?: string }) {
  const router = useRouter();
  const firstEnabled =
    options.scenarios.find((s) => s.enabled && s.value === initialScenario)?.value ?? options.scenarios.find((s) => s.enabled)?.value ?? options.scenarios[0].value;

  const [companySize, setCompanySize] = useState("random");
  const [department, setDepartment] = useState("random");
  // Random by default: you rarely know who you're calling.
  const [personality, setPersonality] = useState("random");
  const [scenario, setScenario] = useState(firstEnabled);
  const [difficulty, setDifficulty] = useState("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedScenario = options.scenarios.find((s) => s.value === scenario);
  const label = (list: { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v;
  const unknowns = [
    companySize === "random" && "the company size",
    department === "random" && "their department",
    personality === "random" && "their personality",
    difficulty === "random" && "how hard they'll be",
  ].filter(Boolean) as string[];
  const randomPart = unknowns.length ? unknowns.join(", ").replace(/, ([^,]*)$/, " or $1") : null;

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
    <div className="mt-6 space-y-4">
      <Section step={1} title="What are you practising?">
        <div className="grid gap-3 sm:grid-cols-2">
          {options.scenarios.map((s) => {
            const selected = s.value === scenario;
            return (
              <button
                key={s.value}
                type="button"
                disabled={!s.enabled}
                onClick={() => setScenario(s.value)}
                aria-pressed={selected}
                className={[
                  "rounded-lg border p-3 text-left transition",
                  selected ? "border-indigo-600 bg-indigo-50" : "border-slate-300 bg-white hover:border-slate-400",
                  !s.enabled ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                <span className="flex items-center justify-between">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-xs text-slate-500">{s.enabled ? `${s.minutes} min` : "Coming soon"}</span>
                </span>
                {s.enabled && <span className="mt-1 block text-xs text-slate-600">{s.success}</span>}
              </button>
            );
          })}
        </div>
        {selectedScenario && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{selectedScenario.brief}</p>}
      </Section>

      <Section step={2} title="Who are you calling?" hint="Random is on by default. Choose one only if you want to practise a particular kind of company.">
        <Group title="Company size" value={companySize} onChange={setCompanySize} choices={[RANDOM, ...options.sizes]} />
        <Group title="Department" value={department} onChange={setDepartment} choices={[RANDOM, ...options.departments]} />
      </Section>

      <Section
        step={3}
        title="What are they like?"
        hint="Random is on by default, because in real life you don't know who picks up. Choose one only if you want to practise a particular type."
      >
        <Group title="Personality" value={personality} onChange={setPersonality} choices={[RANDOM, ...options.personalities]} />
        <Group title="Difficulty" value={difficulty} onChange={setDifficulty} choices={[RANDOM, ...options.difficulties]} />
        {randomPart && (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            You won&apos;t be told {randomPart}, just like a real call to someone you don&apos;t know. After the call, My calls shows what you got.
          </p>
        )}
      </Section>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{selectedScenario?.label}</strong> · {companySize === "random" ? "any size" : label(options.sizes, companySize)} ·{" "}
          {department === "random" ? "any department" : label(options.departments, department)} ·{" "}
          {personality === "random" ? "random personality" : `${label(options.personalities, personality).toLowerCase()}`} ·{" "}
          {difficulty === "random" ? "random difficulty" : `${label(options.difficulties, difficulty).toLowerCase()}`}
        </p>
        <button
          onClick={start}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Finding a prospect…" : "Start"}
        </button>
      </div>
    </div>
  );
}
