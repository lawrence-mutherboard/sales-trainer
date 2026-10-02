// Run with: npm run elevenlabs:voices
// Lists the ElevenLabs voices your API key can use, with their accent and gender, so you can pick favourites and
// paste their IDs into config/ai.json -> tts.elevenlabs.voices. Only reads a list; it costs nothing.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine if missing */
}

interface V {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is empty in .env.local");

  const res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { voices = [] } = (await res.json()) as { voices?: V[] };

  const rows = voices.map((v) => ({
    accent: (v.labels?.accent ?? "?").toLowerCase(),
    gender: (v.labels?.gender ?? "?").toLowerCase(),
    age: (v.labels?.age ?? "").toLowerCase(),
    name: v.name,
    id: v.voice_id,
    kind: v.category ?? "",
    use: v.labels?.use_case ?? v.labels?.descriptive ?? "",
  }));
  rows.sort((a, b) => a.accent.localeCompare(b.accent) || a.gender.localeCompare(b.gender) || a.name.localeCompare(b.name));

  console.log(`${rows.length} voices available to this key.\n`);
  console.table(rows);
  console.log("\nTip: listen to a voice by opening its preview in the ElevenLabs website, then copy its id into config/ai.json.");
  console.log('Example: "uk": { "feminine": ["<id>", "<id>"], "masculine": ["<id>"] }');
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
