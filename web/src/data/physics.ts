/**
 * The physics model of each city (a surface energy balance per surface tile), written by
 * `python -m pipeline.seb_check --all`. Optional: the method page shows its section only when the file has the city.
 */
import { isNumber, isObject } from './parse';

export interface Skill {
  r2: number;
  mae: number;
  /** Model minus satellite, °C. */
  bias: number;
}

/** Mean cell fluxes, W/m². */
export interface Fluxes {
  rn: number;
  h: number;
  le: number;
  dqs: number;
  qf: number;
}

export const PHYSICS_FLUX_KEYS = ['rn', 'h', 'le', 'dqs', 'qf'] as const satisfies readonly (keyof Fluxes)[];

export interface PhysicsBudget {
  /** City minus ring, mean surface temperature, °C. */
  observed: number;
  groups: { id: string; contribution: number }[];
  /** Observed minus the sum of the groups. */
  other: number;
  /** Observed minus modelled contrast: the part of Other where the model misses the satellite. */
  modelGap: number | null;
  /** Cells the budget was computed on, per side; null in a file without it. */
  sample: { inside: number; ring: number } | null;
}

/** A low, estimate, high triple, °C; low ≤ estimate ≤ high. */
export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface PhysicsScenario {
  id: string;
  /** Mean change on the treated surfaces; null when nothing was treated. */
  treated: Range | null;
  /** Mean change over every cell inside the city outline. */
  whole: Range;
  /** Share of the city's area treated, 0–1. */
  areaShare: number | null;
  settings: Record<string, unknown>;
  assumptions: { id: string; text: string }[];
}

export interface CityPhysics {
  skill: { physics: Skill; hybrid: Skill | null; insidePhysics: Skill | null; insideHybrid: Skill | null };
  fluxes: { inside: Fluxes; ring: Fluxes } | null;
  budget: PhysicsBudget | null;
  scenarios: PhysicsScenario[];
  /** Bootstrap refits behind the ranges, and their percentiles. */
  replicates: number | null;
  interval: [number, number] | null;
}

export type Physics = Record<string, CityPhysics>;

function parseSkill(value: unknown): Skill | null {
  if (!isObject(value)) return null;
  const { r2, mae, bias } = value;
  return isNumber(r2) && isNumber(mae) && isNumber(bias) ? { r2, mae, bias } : null;
}

function parseFluxes(value: unknown): Fluxes | null {
  if (!isObject(value)) return null;
  const { rn, h, le, dqs, qf } = value;
  return isNumber(rn) && isNumber(h) && isNumber(le) && isNumber(dqs) && isNumber(qf) ? { rn, h, le, dqs, qf } : null;
}

function parseRange(value: unknown): Range | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isNumber)) return null;
  const [low, mid, high] = value as [number, number, number];
  return low <= mid && mid <= high ? { low, mid, high } : null;
}

function parseBudget(value: unknown): PhysicsBudget | null {
  if (!isObject(value) || !isNumber(value.observed) || !isNumber(value.other) || !Array.isArray(value.groups)) return null;
  const groups = value.groups.flatMap((g) => (isObject(g) && typeof g.id === 'string' && isNumber(g.contribution) ? [{ id: g.id, contribution: g.contribution }] : []));
  const sample = isObject(value.sample) && isNumber(value.sample.inside) && isNumber(value.sample.ring) ? { inside: value.sample.inside, ring: value.sample.ring } : null;
  return { observed: value.observed, groups, other: value.other, modelGap: isNumber(value.modelGap) ? value.modelGap : null, sample };
}

function parseScenario(value: unknown): PhysicsScenario | null {
  if (!isObject(value) || typeof value.id !== 'string') return null;
  const whole = parseRange(value.wholeDT);
  if (!whole) return null;
  const assumptions = Array.isArray(value.assumptions)
    ? value.assumptions.flatMap((a) => (isObject(a) && typeof a.id === 'string' && typeof a.text === 'string' ? [{ id: a.id, text: a.text }] : []))
    : [];
  return {
    id: value.id,
    treated: parseRange(value.treatedDT),
    whole,
    areaShare: isNumber(value.areaShare) ? value.areaShare : null,
    settings: isObject(value.settings) ? value.settings : {},
    assumptions,
  };
}

function parseCity(value: unknown): CityPhysics | null {
  if (!isObject(value) || !isObject(value.skill)) return null;
  const physics = parseSkill(value.skill.physics);
  // Without the skill of the physics there is nothing to put the rest in perspective with.
  if (!physics) return null;
  const inside = isObject(value.skill.inside) ? value.skill.inside : {};
  const fluxesInside = isObject(value.fluxes) ? parseFluxes(value.fluxes.inside) : null;
  const fluxesRing = isObject(value.fluxes) ? parseFluxes(value.fluxes.ring) : null;
  const interval = value.interval;
  return {
    skill: { physics, hybrid: parseSkill(value.skill.hybrid), insidePhysics: parseSkill(inside.physics), insideHybrid: parseSkill(inside.hybrid) },
    fluxes: fluxesInside && fluxesRing ? { inside: fluxesInside, ring: fluxesRing } : null,
    budget: parseBudget(value.budget),
    scenarios: Array.isArray(value.scenarios) ? value.scenarios.flatMap((s) => parseScenario(s) ?? []) : [],
    replicates: isNumber(value.replicates) ? value.replicates : null,
    interval: Array.isArray(interval) && interval.length === 2 && interval.every(isNumber) ? [interval[0] as number, interval[1] as number] : null,
  };
}

/** Lenient: a malformed city or part is dropped rather than breaking the page. */
export function parsePhysics(value: unknown): Physics {
  if (!isObject(value)) return {};
  const out: Physics = {};
  for (const [id, city] of Object.entries(value)) {
    const parsed = parseCity(city);
    if (parsed) out[id] = parsed;
  }
  return out;
}
