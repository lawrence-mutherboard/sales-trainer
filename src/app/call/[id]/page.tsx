import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { config } from "@/lib/config";
import { getSetupOptions } from "@/lib/config/public";
import { pickPortrait } from "@/lib/portrait";
import type { SessionRow } from "@/lib/types";
import { CallClient } from "./CallClient";
import { TABLES } from "@/lib/db/tables";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Row-level security: this only returns the signed-in rep's own sessions. No hidden profile is in this table.
  const { data, error } = await supabase.from(TABLES.sessions).select("*").eq("id", id).maybeSingle();
  if (error) console.error(`call page: could not read the session from the database: ${error.message} (code ${error.code}). If this says "permission denied", the table needs the grants in supabase/grants.sql.`);
  if (!data) notFound();
  const session = data as unknown as SessionRow;

  if (session.status === "ended" || session.status === "scored" || session.status === "score_failed") {
    redirect(`/report/${id}`);
  }

  const options = getSetupOptions();
  const scenario = options.scenarios.find((s) => s.value === session.scenario);
  const sizeLabel = options.sizes.find((s) => s.value === session.company_size)?.label ?? session.company_size;
  const deptLabel = options.departments.find((s) => s.value === session.department)?.label ?? session.department;

  return (
    <CallClient
      sessionId={session.id}
      interrupted={session.status === "in_progress"}
      prospect={{
        name: session.prospect_name,
        title: session.prospect_title,
        company: session.prospect_company,
        sizeLabel,
        deptLabel,
      }}
      scenario={{
        label: scenario?.label ?? session.scenario,
        brief: scenario?.brief ?? "",
        success: scenario?.success ?? "",
        limitMs: (scenario?.minutes ?? 5) * 60_000,
      }}
      personality={session.personality}
      portrait={pickPortrait(session.prospect_name)}
      fillers={config.ai.tts.fillers}
      speakMode={config.ai.tts.speak_mode}
      turnTiming={{
        normalMs: config.listening.normal_ms,
        guessingMs: config.listening.guessing_ms,
        finishedMs: config.listening.finished_ms,
        unfinishedMs: config.listening.unfinished_ms,
      }}
      corrections={config.speechCorrections}
      ring={{
        enabled: config.call.ring.enabled,
        minRings: config.call.ring.min_rings,
        maxRings: Math.max(config.call.ring.min_rings, config.call.ring.max_rings),
        volume: config.call.ring.volume,
        ukPercent: config.ai.tts.accent.uk_percent,
      }}
      silence={{
        enabled: config.silence.enabled,
        firstMs: config.silence.first_ms,
        secondMs: config.silence.second_ms,
        hangupMs: config.silence.hangup_ms,
        moods: config.silence.moods,
        lines: config.silence.lines,
      }}
    />
  );
}
