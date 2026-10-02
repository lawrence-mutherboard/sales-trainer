import "server-only";
import { config, DEPARTMENTS, DIFFICULTIES, PERSONALITIES, SIZES } from "./index";

// The parts of the config that are fine to show the rep before a call. No objections, no persona pools, no rubric.
export interface SetupOptions {
  sizes: { value: string; label: string }[];
  departments: { value: string; label: string }[];
  personalities: { value: string; label: string; hint: string }[];
  difficulties: { value: string; label: string }[];
  scenarios: { value: string; label: string; enabled: boolean; minutes: number; success: string; brief: string }[];
}

export function getSetupOptions(): SetupOptions {
  const p = config.personas;
  return {
    sizes: SIZES.map((v) => ({ value: v, label: p.company_sizes[v].label })),
    departments: DEPARTMENTS.map((v) => ({ value: v, label: p.departments[v].label })),
    personalities: PERSONALITIES.map((v) => ({
      value: v,
      label: p.personalities[v].label,
      hint: "",
    })),
    difficulties: DIFFICULTIES.map((v) => ({ value: v, label: p.difficulties[v].label })),
    scenarios: Object.entries(config.scenarios).map(([value, s]) => ({
      value,
      label: s.label,
      enabled: s.enabled,
      minutes: s.time_limit_min,
      success: s.success_condition,
      brief: s.rep_brief,
    })),
  };
}
