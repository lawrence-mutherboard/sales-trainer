// Generates a library of AI portraits for the prospects, once, into public/portraits/.
//
//   npm run portraits                      -> shows the plan, spends nothing
//   npm run portraits -- --yes             -> generates 12 images (6 feminine, 6 masculine)
//   npm run portraits -- --yes --count 30 --quality medium
//
// Uses OPENAI_API_KEY from .env.local. IMAGE GENERATION COSTS MONEY per image (price depends on model,
// quality and size, so check OpenAI's pricing page first). "--quality low" is the cheapest.
// Existing portraits are kept; new ones are added to the manifest.
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine if the file is missing; the key may already be in the environment */
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const COUNT = Math.max(2, Number(arg("count", "12")));
const QUALITY = arg("quality", "low") as "low" | "medium" | "high";
const MODEL = arg("model", "gpt-image-1-mini");

const AGES = [29, 34, 38, 42, 47, 52, 56];
const BACKGROUNDS = [
  "a bright modern open-plan office",
  "a small home office with a bookshelf",
  "a glass-walled meeting room",
  "a quiet office corner next to a window",
  "a plain light-grey wall",
];
// Independent of gender, name and personality on purpose. A mix that reflects a UK workforce.
const HERITAGE = ["White British", "Black British", "South Asian British", "East Asian British", "Middle Eastern", "mixed heritage", "White European"];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const dir = path.join(process.cwd(), "public", "portraits");
const manifestPath = path.join(dir, "manifest.json");
const manifest: { file: string; gender: "feminine" | "masculine" }[] = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : [];

const plan = Array.from({ length: COUNT }, (_, i) => ({ gender: (i % 2 === 0 ? "feminine" : "masculine") as "feminine" | "masculine" }));

async function main() {
  console.log(`Plan: ${COUNT} portraits (${Math.ceil(COUNT / 2)} feminine / ${Math.floor(COUNT / 2)} masculine), model ${MODEL}, quality ${QUALITY}, 1024x1024.`);
  console.log(`Already in the library: ${manifest.length}.`);
  if (!has("yes")) {
    console.log("\nNothing generated. Image generation costs money per image; check OpenAI's pricing page, then re-run with --yes.");
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (.env.local).");

  fs.mkdirSync(dir, { recursive: true });
  const client = new OpenAI();
  let made = 0;

  for (const [i, p] of plan.entries()) {
    const n = manifest.filter((m) => m.gender === p.gender).length + 1;
    const file = `${p.gender}-${String(n).padStart(2, "0")}.jpg`;
    const prompt =
      `Realistic candid head-and-shoulders photo of a fictional ${pick(AGES)}-year-old ${pick(HERITAGE)} ${p.gender === "feminine" ? "woman" : "man"}, ` +
      `wearing smart business-casual clothes, in ${pick(BACKGROUNDS)}. Natural lighting, relaxed neutral expression, looking at the camera, ` +
      `like a company team-page photo. A completely fictional person, not a real person or celebrity. No text, no logos.`;
    try {
      const res = await client.images.generate({ model: MODEL, prompt, size: "1024x1024", quality: QUALITY, output_format: "jpeg", n: 1 });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("no image returned");
      fs.writeFileSync(path.join(dir, file), Buffer.from(b64, "base64"));
      manifest.push({ file, gender: p.gender });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      made++;
      console.log(`[${i + 1}/${COUNT}] saved ${file}`);
    } catch (err) {
      console.error(`[${i + 1}/${COUNT}] failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\nDone. ${made} new portraits. Library now has ${manifest.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
