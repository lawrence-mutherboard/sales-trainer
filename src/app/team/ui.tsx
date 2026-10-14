import Link from "next/link";

// Small building blocks shared by the manager's Team pages.

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function PeriodTabs({ base, current, extra = "" }: { base: string; current: string; extra?: string }) {
  const options = [
    ["7", "7 days"],
    ["30", "30 days"],
    ["90", "90 days"],
    ["all", "All time"],
  ];
  return (
    <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
      {options.map(([v, label]) => (
        <Link
          key={v}
          href={`${base}?days=${v}${extra}`}
          className={`rounded-md px-3 py-1 ${current === v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

export function ScoreBadge({ total, pass }: { total: number | null; pass: boolean | null }) {
  if (total == null) return <span className="text-xs text-amber-700">Not scored</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-semibold">{total}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
        {pass ? "Pass" : "Fail"}
      </span>
    </span>
  );
}

export function Trend({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  if (value === 0) return <span className="text-slate-500">±0</span>;
  return <span className={value > 0 ? "text-emerald-700" : "text-red-700"}>{value > 0 ? `▲ ${value}` : `▼ ${Math.abs(value)}`}</span>;
}

export function SkillBars({ skills, empty }: { skills: { name: string; avgPct: number; tip: string }[]; empty: string }) {
  if (skills.length === 0) return <p className="mt-3 text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="mt-3 space-y-3">
      {skills.map((s) => (
        <li key={s.name}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{s.name}</span>
            <span className="text-slate-500">{s.avgPct}%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
            <div
              className={`h-1.5 rounded-full ${s.avgPct < 50 ? "bg-red-500" : s.avgPct < 75 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.max(3, s.avgPct)}%` }}
            />
          </div>
          {s.tip && <p className="mt-1 text-xs text-slate-600">{s.tip}</p>}
        </li>
      ))}
    </ul>
  );
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function lastSeen(days: number | null): string {
  if (days == null) return "Never";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function hours(min: number): string {
  return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}
