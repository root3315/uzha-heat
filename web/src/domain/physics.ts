import type { PhysicsBudget, PhysicsScenario } from '../data/physics';
import type { Locale } from '../i18n/locale';
import { formats } from './format';
import { PHYSICS_TEXTS, type SettingsReader } from './physics.texts';

/** The order the scenarios are listed in: surfaces first, then greenery, then waste heat. Unknown ones go last. */
export const SCENARIO_ORDER = ['cool_roofs', 'cool_pavements', 'green_roofs', 'permeable', 'trees', 'waste_heat'];

export function orderedScenarios(scenarios: readonly PhysicsScenario[]): PhysicsScenario[] {
  const rank = (id: string) => {
    const i = SCENARIO_ORDER.indexOf(id);
    return i < 0 ? SCENARIO_ORDER.length : i;
  };
  return [...scenarios].sort((a, b) => rank(a.id) - rank(b.id));
}

export const scenarioLabel = (id: string, locale: Locale): string => PHYSICS_TEXTS[locale].scenarios[id] ?? id;
export const physicsGroupLabel = (id: string, locale: Locale): string => PHYSICS_TEXTS[locale].groups[id] ?? id;

export interface BudgetRow {
  id: string;
  label: string;
  contribution: number;
}

/** The factor groups by size of their part of the heat island, largest first, labelled. Other is kept apart. */
export function budgetRows(budget: PhysicsBudget, locale: Locale): BudgetRow[] {
  return [...budget.groups]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .map((group) => ({ ...group, label: physicsGroupLabel(group.id, locale) }));
}

/** How the physics alone compares with the main model's R²: within 0.02 counts as the same. */
export function compareSkill(physicsR2: number, mainR2: number): 'less' | 'same' | 'more' {
  if (physicsR2 < mainR2 - 0.02) return 'less';
  return physicsR2 > mainR2 + 0.02 ? 'more' : 'same';
}

function reader(settings: Record<string, unknown>): SettingsReader {
  return {
    num: (key) => (typeof settings[key] === 'number' && Number.isFinite(settings[key]) ? (settings[key] as number) : null),
    flag: (key) => (typeof settings[key] === 'boolean' ? (settings[key] as boolean) : null),
    word: (key) => (typeof settings[key] === 'string' ? (settings[key] as string) : null),
    words: (key) => {
      const value = settings[key];
      return Array.isArray(value) && value.every((w) => typeof w === 'string') ? (value as string[]) : null;
    },
  };
}

/**
 * A scenario's assumptions in the page's language, worded from its settings. An assumption the site has no words for,
 * or whose settings it cannot read, is shown as the file has it (English).
 */
export function assumptionTexts(scenario: PhysicsScenario, locale: Locale): string[] {
  const words = PHYSICS_TEXTS[locale].assumptions[scenario.id] ?? {};
  const settings = reader(scenario.settings);
  const f = formats(locale);
  return scenario.assumptions.map((assumption) => words[assumption.id]?.(settings, f.formatPercent, (v) => f.formatNumber(v, 2)) ?? assumption.text);
}
