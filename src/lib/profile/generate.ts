import "server-only";
import { config, type CompanySize, type Department, type Difficulty, type ScenarioKey } from "@/lib/config";
import type { HiddenProfile, SessionSecrets } from "@/lib/types";

// Everything here is generated on the server, per call, from /config/personas.json and objections.json.
// Nothing is calculated by an AI, so it is free, instant, and different each time.

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface GeneratedProspect {
  name: string;
  title: string;
  company: string;
  secrets: SessionSecrets;
}

export function generateProspect(input: {
  companySize: CompanySize;
  department: Department;
  difficulty: Difficulty;
  scenario: ScenarioKey;
}): GeneratedProspect {
  const { personas } = config;
  const size = personas.company_sizes[input.companySize];
  const dept = personas.departments[input.department];
  const names = personas.name_pools;

  const name = `${pick(names.first_names)} ${pick(names.last_names)}`;
  const title = pick(dept.titles);
  const company = `${pick(names.company_prefixes)} ${pick(names.company_suffixes_by_size[input.companySize])}`;
  const staffCount = randInt(size.staff_range[0], size.staff_range[1]);

  const pain = pick(dept.pains);
  const cost = pick(pain.cost_templates);
  const costText = cost.template.replace("{n}", String(randInt(cost.min, cost.max)));

  const budget = pick(size.budget_ranges);
  const approved = Math.random() < budget.approved_probability;

  const altTool = pick(personas.alt_tools[input.department]);
  const competing = shuffle(personas.competing_options)
    .slice(0, randInt(1, 2))
    .map((c) => c.replace("{alt_tool}", altTool))
    .join("; and ");

  const profile: HiddenProfile = {
    current_tools: pick(dept.current_tools),
    surface_complaint: pain.surface,
    real_pain: pain.real,
    cost_of_pain: costText,
    budget: `${budget.range}, ${approved ? "already approved" : "not yet approved"}`,
    decision_maker: pick(size.decision_makers).replace("{boss}", dept.boss_title),
    decision_process_timeline: pick(size.timelines),
    competing_options: competing,
    success_metric: pick(pain.success_metrics),
    champion: pick(personas.champions),
  };

  return {
    name,
    title,
    company,
    secrets: {
      profile,
      objection_ids: chooseObjections(input),
      staff_count: staffCount,
      boss_title: dept.boss_title,
    },
  };
}

function chooseObjections(input: {
  companySize: CompanySize;
  department: Department;
  difficulty: Difficulty;
  scenario: ScenarioKey;
}): string[] {
  const { min, max } = config.personas.difficulties[input.difficulty].objections;
  const wanted = randInt(min, max);

  const applies = config.objections.filter(
    (o) =>
      (o.departments.length === 0 || o.departments.includes(input.department)) &&
      (o.company_sizes.length === 0 || o.company_sizes.includes(input.companySize)) &&
      (o.scenarios.length === 0 || o.scenarios.includes(input.scenario)),
  );

  const chosen = applies.filter((o) => o.default);
  // Prefer department- or size-specific objections before generic ones, so they actually show up.
  const specific = shuffle(applies.filter((o) => !o.default && (o.departments.length > 0 || o.company_sizes.length > 0)));
  const generic = shuffle(applies.filter((o) => !o.default && o.departments.length === 0 && o.company_sizes.length === 0));

  for (const o of [...specific, ...generic]) {
    if (chosen.length >= wanted) break;
    chosen.push(o);
  }
  return chosen.slice(0, Math.max(wanted, 1)).map((o) => o.id);
}
