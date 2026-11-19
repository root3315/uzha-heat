import { describe, expect, it } from 'vitest';
import type { PhysicsScenario } from '../data/physics';
import { assumptionTexts, budgetRows, compareSkill, orderedScenarios, scenarioLabel } from './physics';

const scenario = (id: string, settings: Record<string, unknown> = {}, assumptions: { id: string; text: string }[] = []): PhysicsScenario => ({
  id,
  treated: null,
  whole: { low: -1, mid: -0.5, high: -0.2 },
  areaShare: 0.3,
  settings,
  assumptions,
});

describe('physics', () => {
  it('lists the scenarios in a fixed order, unknown ones last', () => {
    const ids = orderedScenarios(['waste_heat', 'mystery', 'trees', 'cool_roofs'].map((id) => scenario(id))).map((s) => s.id);
    expect(ids).toEqual(['cool_roofs', 'trees', 'waste_heat', 'mystery']);
    expect(scenarioLabel('mystery', 'en')).toBe('mystery');
    expect(scenarioLabel('green_roofs', 'ru')).toBe('Зелёные крыши');
  });

  it('sorts the budget by size of the part, labelled', () => {
    const rows = budgetRows({ observed: 2, groups: [{ id: 'albedo', contribution: 0.1 }, { id: 'sealing', contribution: -0.9 }], other: 2.8, modelGap: null, sample: null }, 'en');
    expect(rows.map((r) => r.id)).toEqual(['sealing', 'albedo']);
    expect(rows[0]?.label).toBe('Sealed share of the ground');
  });

  it('says plainly when the physics explains less than the main model', () => {
    expect(compareSkill(0.3, 0.74)).toBe('less');
    expect(compareSkill(0.73, 0.74)).toBe('same');
    expect(compareSkill(0.8, 0.74)).toBe('more');
  });

  it('words the assumptions from the settings in each language, and falls back to the file', () => {
    const roofs = scenario('cool_roofs', { albedo: 0.55, emissivity: null }, [
      { id: 'albedo', text: 'file albedo' },
      { id: 'emissivity', text: 'file emissivity' },
      { id: 'new_one', text: 'An assumption the site has no words for.' },
    ]);
    expect(assumptionTexts(roofs, 'ru')).toEqual([
      'Каждая обработанная крыша получает альбедо 0,55 (состаренное покрытие, не свежее).',
      'Излучательная способность крыш не меняется.',
      'An assumption the site has no words for.',
    ]);
    expect(assumptionTexts(roofs, 'en')[0]).toContain('albedo 0.55');
  });

  it('keeps the file text when the settings differ from what the words describe', () => {
    const trees = scenario('trees', { share: 0.1, source: ['paved'] }, [{ id: 'share', text: 'file share' }]);
    expect(assumptionTexts(trees, 'ru')).toEqual(['file share']);
    const pavers = scenario('permeable', { share: 0.5, to: 'grass' }, [{ id: 'share', text: 'file share' }]);
    expect(assumptionTexts(pavers, 'en')[0]).toMatch(/^50\s?% of squares and pavements/);
  });
});
