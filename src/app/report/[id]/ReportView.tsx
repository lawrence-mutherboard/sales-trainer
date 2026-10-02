import { config } from "@/lib/config";
import type { ReactNode } from "react";
import type { CriterionResult, KeyMoment, ScoreResult, SessionRow, TurnRow } from "@/lib/types";
import { MetricCard, RangeBar, ScoreBar, statusOf } from "./parts";

const GRADE_STYLE: Record<string, { chip: string; border: string; label: string }> = {
  full: { chip: "bg-emerald-100 text-emerald-800", border: "border-l-emerald-500", label: "Full marks" },
  partial: { chip: "bg-amber-100 text-amber-800", border: "border-l-amber-500", label: "Partly" },
  zero: { chip: "bg-red-100 text-red-800", border: "border-l-red-500", label: "Missed" },
};

function mmss(ms: number | null) {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function clock(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return <span className="text-xs text-slate-400">first attempt</span>;
  const d = now - before;
  if (d === 0) return <span className="text-xs text-slate-500">same as last attempt</span>;
  return (
    <span className={`text-xs font-medium ${d > 0 ? "text-emerald-700" : "text-red-700"}`}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)} vs last attempt
    </span>
  );
}

function SectionTitle({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div id={id} className="mb-3 scroll-mt-20">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function ReportView({
  result,
  session,
  turns,
  prev,
  footer,
}: {
  result: ScoreResult;
  session: SessionRow;
  turns: TurnRow[];
  prev: ScoreResult | null;
  /** The "retry" button. Passed in so this component stays free of client-only code. */
  footer: ReactNode;
}) {
  const moments = new Map<number, KeyMoment[]>();
  for (const m of result.key_moments) moments.set(m.turn, [...(moments.get(m.turn) ?? []), m]);

  const core = result.criteria.filter((c) => c.section === "core");
  const module_ = result.criteria.filter((c) => c.section === "module");
  const moduleLabel = result.sections.find((s) => s.key === "module")?.label ?? "Scenario";

  const bench = config.benchmarks.metrics[session.scenario];
  const m = result.metrics;
  const accuracy = result.sections.find((s) => s.key === "accuracy");
  const lost = result.criteria.reduce((n, c) => n + (c.max - c.points), 0);

  return (
    <div className="space-y-10">
      {/* Jump links */}
      <nav className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-slate-200 bg-slate-50/95 px-4 py-2 text-sm backdrop-blur">
        <ul className="flex gap-5 whitespace-nowrap text-slate-600">
          {[
            ["#scores", "Scores"],
            ["#improve", "Improve"],
            ["#speaking", "Speaking"],
            ["#criteria", "Criteria"],
            ["#hidden", "Hidden info"],
            ["#transcript", "Transcript"],
          ].map(([href, label]) => (
            <li key={href}>
              <a href={href} className="hover:text-indigo-600">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* 1. Overall score and pass/fail */}
      <section id="scores" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">
          {result.scenario_label} · {session.prospect_name}, {session.prospect_title} at {session.prospect_company} ·{" "}
          {new Date(session.started_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <span className="text-6xl font-bold tracking-tight">{result.total}</span>
            <span className="text-2xl text-slate-400"> / 100</span>
          </div>
          <span
            className={`rounded-full px-4 py-1 text-sm font-semibold ${result.pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
          >
            {result.pass ? "PASS" : "FAIL"}
          </span>
        </div>
        <p className="mt-3 text-slate-700">
          <strong>Goal:</strong> {result.success_condition}
        </p>
        {result.success_evidence && <p className="mt-1 text-sm text-slate-500">{result.success_evidence}</p>}
        <p className="mt-4 text-slate-800">{result.summary}</p>

        {/* Section scores */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {result.sections.map((s) => (
            <div key={s.key} className="rounded-lg bg-slate-50 p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-slate-600">{s.label}</p>
                <p className="font-semibold">
                  {s.points} <span className="text-sm font-normal text-slate-400">/ {s.max}</span>
                </p>
              </div>
              <div className="mt-2">
                <ScoreBar value={s.points} max={s.max} />
              </div>
              <div className="mt-2">
                <Delta now={s.points} before={prev?.sections.find((p) => p.key === s.key)?.points} />
              </div>
            </div>
          ))}
        </div>
        {lost > 0 && (
          <p className="mt-4 text-sm text-slate-500">
            You left <strong className="text-slate-700">{lost} points</strong> on the table across the criteria below
            {accuracy && accuracy.points < accuracy.max ? ` (plus ${accuracy.max - accuracy.points} lost on accuracy)` : ""}.
          </p>
        )}
      </section>

      {/* 2. What to do next: strengths and the three biggest improvements */}
      <section>
        <SectionTitle id="improve" title="What to work on" hint="The three changes that would have won you the most points." />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {result.top_improvements.map((imp, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="font-medium">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-sm text-white">
                    {i + 1}
                  </span>
                  {imp.title}
                </p>
                {imp.moment_quote && (
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="text-slate-400">You said:</span> <span className="italic">&ldquo;{imp.moment_quote}&rdquo;</span>
                    {imp.turn ? (
                      <a href={`#turn-${imp.turn}`} className="ml-1 text-indigo-600 hover:underline">
                        (turn {imp.turn})
                      </a>
                    ) : null}
                  </p>
                )}
                <p className="mt-2 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                  <strong>Try saying:</strong> &ldquo;{imp.example_line}&rdquo;
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="font-medium text-emerald-900">What went well</h3>
            {result.strengths && result.strengths.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm text-emerald-950">
                {result.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden>✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-emerald-900">
                {core.filter((c) => c.grade === "full").length + module_.filter((c) => c.grade === "full").length > 0
                  ? "You earned full marks on: " +
                    [...core, ...module_]
                      .filter((c) => c.grade === "full")
                      .map((c) => c.name)
                      .join(", ") +
                    "."
                  : "No criteria earned full marks this time. Start with the three changes on the left."}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 3. Speaking metrics */}
      <section>
        <SectionTitle
          id="speaking"
          title="How you sounded"
          hint="Measured from your recording, not judged by the AI. Benchmarks come from public sales research."
        />
        {!m ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Speaking metrics weren&apos;t recorded for this older call.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Talk time */}
            {bench?.talk_share && (
              <MetricCard
                title={bench.talk_share.label}
                status={result.talk.available ? statusOf(Math.round(result.talk.rep_share * 100), bench.talk_share.min, bench.talk_share.max) : "none"}
                target={bench.talk_share.target}
                note={bench.talk_share.note}
              >
                {result.talk.available ? (
                  <>
                    <p className="text-3xl font-semibold">
                      {Math.round(result.talk.rep_share * 100)}%
                      <span className="ml-2 text-base font-normal text-slate-400">
                        you · {Math.round((1 - result.talk.rep_share) * 100)}% prospect
                      </span>
                    </p>
                    <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-indigo-600" style={{ width: `${Math.round(result.talk.rep_share * 100)}%` }} />
                      <div className="bg-slate-300" style={{ width: `${100 - Math.round(result.talk.rep_share * 100)}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Not measured for typed calls.</p>
                )}
              </MetricCard>
            )}

            {/* Pace */}
            {bench?.wpm && (
              <MetricCard
                title={bench.wpm.label}
                status={statusOf(m.wpm, bench.wpm.min, bench.wpm.max)}
                target={`${bench.wpm.target} ${bench.wpm.unit}`}
                note={bench.wpm.note}
              >
                {m.wpm != null ? (
                  <>
                    <p className="text-3xl font-semibold">
                      {m.wpm}
                      <span className="ml-1 text-base font-normal text-slate-400">words/min</span>
                    </p>
                    <div className="pb-5">
                      <RangeBar value={m.wpm} scaleMin={80} scaleMax={200} targetMin={bench.wpm.min} targetMax={bench.wpm.max} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Needs a spoken call of at least a few seconds.</p>
                )}
              </MetricCard>
            )}

            {/* Fillers */}
            {bench?.filler_pct && (
              <MetricCard
                title={bench.filler_pct.label}
                status={statusOf(m.filler_pct, bench.filler_pct.min, bench.filler_pct.max)}
                target={bench.filler_pct.target}
                note={bench.filler_pct.note}
              >
                <p className="text-3xl font-semibold">
                  {m.filler_count}
                  <span className="ml-2 text-base font-normal text-slate-400">({m.filler_pct}% of your words)</span>
                </p>
                {m.fillers.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {m.fillers.slice(0, 6).map((f) => (
                      <li key={f.word} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {f.word} <strong>×{f.count}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">None picked up.</p>
                )}
              </MetricCard>
            )}

            {/* Monologue */}
            {bench?.longest_monologue_s && (
              <MetricCard
                title={bench.longest_monologue_s.label}
                status={statusOf(m.longest_monologue_s, bench.longest_monologue_s.min, bench.longest_monologue_s.max)}
                target={bench.longest_monologue_s.target}
                note={bench.longest_monologue_s.note}
              >
                {m.longest_monologue_s != null ? (
                  <p className="text-3xl font-semibold">
                    {m.longest_monologue_s}
                    <span className="ml-1 text-base font-normal text-slate-400">seconds</span>
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Not measured for typed calls.</p>
                )}
              </MetricCard>
            )}

            {/* Questions */}
            {bench?.questions && (
              <MetricCard
                title={bench.questions.label}
                status={statusOf(m.questions, bench.questions.min, bench.questions.max)}
                target={bench.questions.target}
                note={bench.questions.note}
              >
                <p className="text-3xl font-semibold">{m.questions}</p>
              </MetricCard>
            )}

            {/* Call length and word counts */}
            <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-medium text-slate-600">Call length</h3>
              <p className="mt-2 text-3xl font-semibold">{clock(m.call_seconds)}</p>
              <p className="mt-auto pt-4 text-xs text-slate-500">
                You spoke {m.rep_words} words and the prospect {m.prospect_words}. Ended by{" "}
                {session.ended_by === "prospect" ? "the prospect" : session.ended_by === "timeout" ? "the time limit" : "you"}.
              </p>
            </div>
          </div>
        )}
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-700">Where the benchmarks come from</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {config.benchmarks.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} className="text-indigo-600 hover:underline" target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2">Pace and longest stretch are estimates from timestamps. Filler words are a minimum, because speech-to-text often removes them.</p>
        </details>
      </section>

      {/* 4. Criterion breakdown */}
      <section>
        <SectionTitle
          id="criteria"
          title="Criterion breakdown"
          hint="For each: what you said, what to do differently, and what full marks sounds like."
        />
        <CriteriaGroup title="Core" items={core} />
        <CriteriaGroup title={moduleLabel} items={module_} />
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Accuracy of prices and facts</h3>
            <span className="text-sm font-semibold">{accuracy?.points} / {accuracy?.max}</span>
          </div>
          {result.accuracy_errors.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-700">No wrong prices or facts spotted.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {result.accuracy_errors.map((e, i) => (
                <li key={i} className="rounded-md bg-red-50 px-3 py-2">
                  <span className="italic">&ldquo;{e.quote}&rdquo;</span> {e.turn ? <span className="text-slate-500">(turn {e.turn})</span> : null}
                  <br />
                  {e.issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 5. Hidden profile reveal */}
      <section>
        <SectionTitle id="hidden" title="What the prospect was hiding" hint="Facts the prospect would have told you if you had asked the right question." />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="font-medium text-emerald-900">You uncovered ({result.profile_uncovered.length})</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {result.profile_uncovered.map((f) => (
                <li key={f.key}>
                  <strong>{f.label}:</strong> {f.truth}
                </li>
              ))}
              {result.profile_uncovered.length === 0 && <li className="text-slate-600">Nothing this time.</li>}
            </ul>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="font-medium text-red-900">You missed ({result.profile_missed.length})</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {result.profile_missed.map((f) => (
                <li key={f.key}>
                  <strong>{f.label}:</strong> {f.truth}
                </li>
              ))}
              {result.profile_missed.length === 0 && <li className="text-slate-600">You found everything. Impressive.</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* 6. Transcript */}
      <section>
        <SectionTitle id="transcript" title="Transcript" hint="Audio playback arrives once call audio is stored (a later phase)." />
        <ol className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {turns.map((t) => {
            const ms = moments.get(t.idx + 1) ?? [];
            return (
              <li key={t.id} id={`turn-${t.idx + 1}`} className="scroll-mt-20 text-sm">
                <span className="mr-2 font-mono text-xs text-slate-400">
                  {t.idx + 1} {mmss(t.started_ms)}
                </span>
                <span className={`font-semibold ${t.speaker === "rep" ? "text-indigo-700" : "text-slate-700"}`}>
                  {t.speaker === "rep" ? "You" : session.prospect_name.split(" ")[0]}:
                </span>{" "}
                {t.text}
                {ms.map((mm, i) => (
                  <span
                    key={i}
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${mm.kind === "strength" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                  >
                    {mm.kind === "strength" ? "✓" : "✗"} {mm.label}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      </section>

      {/* 7. Retry */}
      <section className="pb-8">
        {footer}
      </section>
    </div>
  );
}

function CriteriaGroup({ title, items }: { title: string; items: CriterionResult[] }) {
  const earned = items.reduce((n, c) => n + c.points, 0);
  const max = items.reduce((n, c) => n + c.max, 0);
  return (
    <div className="mt-6 first:mt-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        <span className="text-sm text-slate-500">
          {earned} / {max}
        </span>
      </div>
      <ul className="space-y-3">
        {items.map((c) => {
          const g = GRADE_STYLE[c.grade];
          return (
            <li key={c.id} className={`rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-sm ${g.border}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.chip}`}>{g.label}</span>
                </div>
                <span className="whitespace-nowrap font-semibold">
                  {c.points} <span className="font-normal text-slate-400">/ {c.max}</span>
                </span>
              </div>
              <div className="mt-2">
                <ScoreBar value={c.points} max={c.max} />
              </div>

              <dl className="mt-3 space-y-3 text-sm">
                {c.quote && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">What you said</dt>
                    <dd className="mt-0.5 text-slate-700">
                      <span className="italic">&ldquo;{c.quote}&rdquo;</span>
                      {c.turn ? (
                        <a href={`#turn-${c.turn}`} className="ml-1 text-indigo-600 hover:underline">
                          (turn {c.turn})
                        </a>
                      ) : null}
                    </dd>
                  </div>
                )}
                {c.note && <p className="text-sm font-medium text-amber-700">{c.note}</p>}
                {c.improve && (
                  <div className="rounded-md bg-amber-50 px-3 py-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-amber-700">Room for improvement</dt>
                    <dd className="mt-0.5 text-slate-800">{c.improve}</dd>
                  </div>
                )}
                {c.tip && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Full marks sounds like</dt>
                    <dd className="mt-0.5 text-slate-700">{c.tip}</dd>
                  </div>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
