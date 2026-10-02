// Small display pieces for the report. All plain server-rendered markup (no client JavaScript).
import type { ReactNode } from "react";

export type Status = "good" | "high" | "low" | "none";

/** Compares a value with a benchmark range. */
export function statusOf(value: number | null | undefined, min?: number, max?: number): Status {
  if (value == null) return "none";
  if (max !== undefined && value > max) return "high";
  if (min !== undefined && value < min) return "low";
  return "good";
}

const CHIP: Record<Status, { text: string; cls: string }> = {
  good: { text: "On target", cls: "bg-emerald-100 text-emerald-800" },
  high: { text: "Above target", cls: "bg-amber-100 text-amber-800" },
  low: { text: "Below target", cls: "bg-amber-100 text-amber-800" },
  none: { text: "Not measured", cls: "bg-slate-100 text-slate-500" },
};

export function StatusChip({ status, labels }: { status: Status; labels?: Partial<Record<Status, string>> }) {
  const c = CHIP[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>{labels?.[status] ?? c.text}</span>;
}

/** A simple filled bar: how much of the maximum was earned. */
export function ScoreBar({ value, max, tone }: { value: number; max: number; tone?: "good" | "ok" | "bad" }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  const auto = pct >= 75 ? "good" : pct >= 40 ? "ok" : "bad";
  const colour = { good: "bg-emerald-500", ok: "bg-amber-500", bad: "bg-red-500" }[tone ?? auto];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${pct}%`}>
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A scale with a shaded target band and a dot for the rep's value. */
export function RangeBar({
  value,
  scaleMin,
  scaleMax,
  targetMin,
  targetMax,
}: {
  value: number | null;
  scaleMin: number;
  scaleMax: number;
  targetMin?: number;
  targetMax?: number;
}) {
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - scaleMin) / (scaleMax - scaleMin)) * 100))}%`;
  const bandStart = targetMin ?? scaleMin;
  const bandEnd = targetMax ?? scaleMax;
  return (
    <div className="relative mt-3 h-3 w-full rounded-full bg-slate-100">
      <div
        className="absolute top-0 h-3 rounded-full bg-emerald-200"
        style={{ left: pos(bandStart), width: `calc(${pos(bandEnd)} - ${pos(bandStart)})` }}
      />
      {value != null && (
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 shadow"
          style={{ left: pos(value) }}
        />
      )}
      <div className="absolute -bottom-5 left-0 text-[10px] text-slate-400">{scaleMin}</div>
      <div className="absolute -bottom-5 right-0 text-[10px] text-slate-400">{scaleMax}+</div>
    </div>
  );
}

export function MetricCard({
  title,
  status,
  children,
  target,
  note,
}: {
  title: string;
  status: Status;
  children: ReactNode;
  target: string;
  note: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-600">{title}</h3>
        <StatusChip status={status} />
      </div>
      <div className="mt-2">{children}</div>
      <p className="mt-auto pt-4 text-xs text-slate-500">
        <strong className="text-slate-700">Benchmark: {target}.</strong> {note}
      </p>
    </div>
  );
}
