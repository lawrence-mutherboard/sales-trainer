import type { TalkStats, TurnRow } from "@/lib/types";

/**
 * Talk ratio is computed here, from timestamps, never judged by the AI.
 * rep_ms / prospect_ms are the summed durations of each side's turns (ms on the call clock).
 * Typed calls have no meaningful speaking time, so the ratio is marked unavailable.
 */
export function computeTalkStats(
  turns: Pick<TurnRow, "speaker" | "started_ms" | "ended_ms">[],
  limit: number,
  inputMode: "voice" | "typed",
): TalkStats {
  let rep = 0;
  let prospect = 0;
  for (const t of turns) {
    if (t.started_ms == null || t.ended_ms == null) continue;
    const d = Math.max(0, t.ended_ms - t.started_ms);
    if (t.speaker === "rep") rep += d;
    else prospect += d;
  }
  const total = rep + prospect;
  const available = inputMode === "voice" && total > 0;
  const share = available ? rep / total : 0;
  return {
    available,
    rep_ms: rep,
    prospect_ms: prospect,
    rep_share: share,
    limit,
    over_limit: available && share > limit,
  };
}
