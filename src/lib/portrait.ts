import "server-only";
import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

// Picks a pre-generated AI portrait for the prospect (see scripts/generate-portraits.ts).
// Matched to the name's gender and then chosen by name, so the same prospect always gets the same face.
// Portraits are deliberately NOT tied to personality, difficulty or company, to avoid stereotyping.
// Returns null when no portraits have been generated yet; the UI then shows initials.

interface PortraitEntry {
  file: string;
  gender: "feminine" | "masculine";
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pickPortrait(prospectName: string): string | null {
  try {
    const dir = path.join(process.cwd(), "public", "portraits");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as PortraitEntry[];
    const first = prospectName.split(/\s+/)[0]?.toLowerCase() ?? "";
    const feminine = config.personas.name_pools.feminine_first_names.some((n) => n.toLowerCase() === first);
    const wanted = feminine ? "feminine" : "masculine";
    const pool = manifest.filter((e) => e.gender === wanted && fs.existsSync(path.join(dir, e.file)));
    if (!pool.length) return null;
    return `/portraits/${pool[hash(prospectName) % pool.length].file}`;
  } catch {
    return null;
  }
}
