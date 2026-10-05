import "server-only";
import { z } from "zod";

import businessJson from "../../../config/business.json";
import aiJson from "../../../config/ai.json";
import personasJson from "../../../config/personas.json";
import objectionsJson from "../../../config/objections.json";
import scenariosJson from "../../../config/scenarios.json";
import rubricJson from "../../../config/rubric.json";
import examplesJson from "../../../config/roleplay_examples.json";
import correctionsJson from "../../../config/speech_corrections.json";
import silenceJson from "../../../config/silence.json";
import callJson from "../../../config/call.json";
import listeningJson from "../../../config/listening.json";
import benchmarksJson from "../../../config/benchmarks.json";

// All business content lives in /config. This file only validates it and gives it types.
// Config is server-only on purpose: the browser never receives objections, persona pools or the rubric.

export const SIZES = ["smb", "mid_market", "enterprise"] as const;
export const DEPARTMENTS = ["sales", "operations", "product", "finance"] as const;
export const PERSONALITIES = ["friendly", "uninterested", "skeptical"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type CompanySize = (typeof SIZES)[number];
export type Department = (typeof DEPARTMENTS)[number];
export type Personality = (typeof PERSONALITIES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type ScenarioKey = string;

const business = z.object({
  company: z.object({
    name: z.string(),
    description: z.string(),
    services: z.array(z.string()),
    services_not_offered: z.array(z.string()),
  }),
  rate: z.object({ currency: z.string(), symbol: z.string(), per_hour: z.number() }),
  default_prospect_stance: z.string(),
  value_points: z.array(z.string()),
  monday_pricing: z.object({
    product: z.string(),
    currency: z.string(),
    unit: z.string(),
    last_verified: z.string().nullable(),
    plans: z.array(z.object({ name: z.string(), annual: z.string(), monthly: z.string(), notes: z.string() })),
    crm: z.object({
      note: z.string(),
      plans: z.array(z.object({ name: z.string(), annual: z.string() })),
    }),
    seat_bucket_note: z.string(),
  }),
  discount_rule: z.object({ max_percent: z.number(), alternative: z.string() }),
});

const ai = z.object({
  stt: z.object({
    model: z.string(),
    prompt: z.string(),
    vocabulary: z.array(z.string()),
  }),
  tts: z.object({
    speed: z.number(),
    elevenlabs: z.object({
      model_id: z.string(),
      voices: z.object({
        uk: z.object({ feminine: z.array(z.string()), masculine: z.array(z.string()) }),
        us: z.object({ feminine: z.array(z.string()), masculine: z.array(z.string()) }),
      }),
      voice_settings: z.object({ stability: z.number(), similarity_boost: z.number(), style: z.number(), use_speaker_boost: z.boolean() }),
      moods: z.record(z.string(), z.object({ stability: z.number(), style: z.number() })),
      personalities: z.record(z.string(), z.object({ stability: z.number(), style: z.number() })),
    }),
    // The labels the AI uses to show how the prospect feels (the app uses the names).
    moods: z.record(z.string(), z.string()),
    // "whole" = the reply is spoken as one piece (smoothest). "first_then_rest" = first sentence, then the rest. "sentences" = sentence by sentence (starts soonest).
    speak_mode: z.enum(["whole", "first_then_rest", "sentences"]),
    accent: z.object({ uk_percent: z.number().min(0).max(100) }),
    // Mood only changes the speaking pace (a multiplier on "speed"), which never changes who the voice sounds like.
    mood_speed: z.record(z.string(), z.number()),
    fillers: z.array(z.string()),
  }),
  prospect: z.object({
    model: z.string(),
    thinking: z.enum(["between_tools", "none"]),
    max_tokens: z.number(),
  }),
  tidy: z.object({ enabled: z.boolean(), model: z.string() }),
  scorer: z.object({
    model: z.string(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    max_tokens: z.number(),
  }),
  refusal_fallback: z.object({
    enabled: z.boolean(),
    beta: z.string(),
    supported_models: z.array(z.string()),
  }),
});

// Zod 3 infers z.record(z.enum(...)) as Partial<...>. This helper gives a fully-required object per key instead.
function keyed<K extends string, T extends z.ZodTypeAny>(keys: readonly K[], schema: T) {
  return z.object(Object.fromEntries(keys.map((k) => [k, schema])) as Record<K, T>);
}

const budgetRange = z.object({ range: z.string(), approved_probability: z.number() });
const costTemplate = z.object({ template: z.string(), min: z.number(), max: z.number() });

const personas = z.object({
  company_sizes: keyed(
    SIZES,
    z.object({
      label: z.string(),
      staff_range: z.tuple([z.number(), z.number()]),
      behaviour: z.string(),
      decision_makers: z.array(z.string()),
      budget_ranges: z.array(budgetRange),
      timelines: z.array(z.string()),
    }),
  ),
  departments: keyed(
    DEPARTMENTS,
    z.object({
      label: z.string(),
      titles: z.array(z.string()),
      boss_title: z.string(),
      cares_most_about: z.string(),
      current_tools: z.array(z.string()),
      pains: z.array(
        z.object({
          surface: z.string(),
          real: z.string(),
          cost_templates: z.array(costTemplate),
          success_metrics: z.array(z.string()),
        }),
      ),
    }),
  ),
  competing_options: z.array(z.string()),
  alt_tools: keyed(DEPARTMENTS, z.array(z.string())),
  champions: z.array(z.string()),
  personalities: keyed(PERSONALITIES, z.object({ label: z.string(), behaviour: z.string() })),
  difficulties: keyed(
    DIFFICULTIES,
    z.object({
      label: z.string(),
      objections: z.object({ min: z.number(), max: z.number() }),
      behaviour: z.string(),
    }),
  ),
  name_pools: z.object({
    // Used to pick a matching-gender voice for the prospect (first names not listed here get a masculine voice).
    feminine_first_names: z.array(z.string()),
    first_names: z.array(z.string()),
    last_names: z.array(z.string()),
    company_prefixes: z.array(z.string()),
    company_suffixes_by_size: keyed(SIZES, z.array(z.string())),
  }),
});

const objections = z.object({
  objections: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      default: z.boolean(),
      departments: z.array(z.string()),
      company_sizes: z.array(z.string()),
      scenarios: z.array(z.string()),
      resolved_when: z.string(),
    }),
  ),
});

const scenarios = z.object({
  scenarios: z.record(
    z.string(),
    z.object({
      label: z.string(),
      enabled: z.boolean(),
      module: z.string(),
      time_limit_min: z.number(),
      starting_situation: z.string(),
      success_condition: z.string(),
      rep_brief: z.string(),
      prospect_opening: z.string(),
      prospect_guidance: z.string(),
      proposal: z.object({ hours: z.number() }).optional(),
    }),
  ),
});

const criterion = z.object({
  id: z.string(),
  name: z.string(),
  max: z.number(),
  question: z.string(),
  full: z.string(),
});

const rubric = z.object({
  grade_points: z.object({ full: z.number(), partial: z.number(), zero: z.number() }),
  core: z.object({
    label: z.string(),
    criteria: z.array(
      criterion.extend({
        talk_ratio_max: z.number().optional(),
        talk_ratio_max_by_scenario: z.record(z.string(), z.number()).optional(),
        over_ratio_cap_grade: z.enum(["partial", "zero"]).optional(),
      }),
    ),
  }),
  modules: z.record(
    z.string(),
    z.object({ label: z.string(), framework: z.string(), criteria: z.array(criterion) }),
  ),
  accuracy: z.object({
    label: z.string(),
    max: z.number(),
    penalty_wrong_fact: z.number(),
    penalty_unoffered_service: z.number(),
    instructions: z.string(),
  }),
});

export type BusinessConfig = z.infer<typeof business>;
export type AiConfig = z.infer<typeof ai>;
export type PersonasConfig = z.infer<typeof personas>;
export type ObjectionDef = z.infer<typeof objections>["objections"][number];
export type ScenarioDef = z.infer<typeof scenarios>["scenarios"][string];
export type RubricConfig = z.infer<typeof rubric>;
export type Criterion = z.infer<typeof criterion>;

const silence = z.object({
  enabled: z.boolean(),
  first_ms: z.number().min(1000),
  second_ms: z.number().min(1000),
  hangup_ms: z.number().min(1000),
  moods: z.object({ first: z.string(), second: z.string(), hangup: z.string() }),
  lines: z.object({
    first: z.array(z.string()).min(1),
    second: z.array(z.string()).min(1),
    hangup: z.array(z.string()).min(1),
  }),
});

const call = z.object({
  ring: z.object({ enabled: z.boolean(), min_rings: z.number().int().min(1), max_rings: z.number().int().min(1), volume: z.number().min(0).max(1) }),
});

const examples = z.object({
  examples: z.array(z.object({ rep: z.string(), customer: z.string(), mood: z.string() })),
});

export const config = {
  silence: silence.parse(silenceJson),
  call: call.parse(callJson),
  benchmarks: z
    .object({
      sources: z.array(z.object({ label: z.string(), url: z.string() })),
      metrics: z.record(
        z.string(),
        z.record(z.string(), z.object({ label: z.string(), unit: z.string(), min: z.number().optional(), max: z.number().optional(), target: z.string(), note: z.string() })),
      ),
    })
    .parse(benchmarksJson),
  listening: z.object({ normal_ms: z.number().min(200), guessing_ms: z.number().min(200), finished_ms: z.number().min(200), unfinished_ms: z.number().min(200) }).parse(listeningJson),
  examples: examples.parse(examplesJson).examples,
  speechCorrections: z.object({ corrections: z.array(z.object({ heard: z.string(), said: z.string() })) }).parse(correctionsJson).corrections,
  business: business.parse(businessJson),
  ai: ai.parse(aiJson),
  personas: personas.parse(personasJson),
  objections: objections.parse(objectionsJson).objections,
  scenarios: scenarios.parse(scenariosJson).scenarios,
  rubric: rubric.parse(rubricJson),
};

// Fail loudly on config mistakes that would silently break scoring.
function checkConfig() {
  const { rubric: r, scenarios: s } = config;
  const coreTotal = r.core.criteria.reduce((n, c) => n + c.max, 0);
  if (coreTotal !== 30) throw new Error(`rubric.json: core criteria must total 30, got ${coreTotal}`);
  for (const [key, mod] of Object.entries(r.modules)) {
    const total = mod.criteria.reduce((n, c) => n + c.max, 0);
    if (total !== 60) throw new Error(`rubric.json: module "${key}" must total 60, got ${total}`);
  }
  if (r.accuracy.max !== 10) throw new Error("rubric.json: accuracy max must be 10");
  const moods = config.ai.tts.moods;
  for (const ex of config.examples) {
    if (!moods[ex.mood]) throw new Error(`roleplay_examples.json: unknown mood "${ex.mood}" (add it to ai.json -> tts.moods)`);
  }
  for (const m of Object.values(config.silence.moods)) {
    if (!moods[m]) throw new Error(`silence.json: unknown mood "${m}" (add it to ai.json -> tts.moods)`);
  }
  for (const p of Object.keys(config.personas.personalities)) {
    if (!config.ai.tts.elevenlabs.personalities[p]) throw new Error(`ai.json -> tts.elevenlabs.personalities is missing "${p}"`);
  }
  for (const [key, sc] of Object.entries(s)) {
    if (!r.modules[sc.module]) throw new Error(`scenarios.json: "${key}" points at unknown rubric module "${sc.module}"`);
  }
}
checkConfig();

export function getScenario(key: string): ScenarioDef | undefined {
  return config.scenarios[key];
}
