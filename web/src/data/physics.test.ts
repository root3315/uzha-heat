import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePhysics } from './physics';

const skill = { r2: 0.3, mae: 2.1, bias: -0.2 };
const fluxes = { rn: 520, h: 260, le: 110, dqs: 170, qf: 20 };

const city = {
  skill: { physics: skill, hybrid: { r2: 0.7, mae: 1.3, bias: 0 }, inside: { physics: { r2: 0.2, mae: 1.9, bias: 0.1 }, hybrid: null } },
  fluxes: { inside: fluxes, ring: { ...fluxes, qf: 5 } },
  budget: {
    observed: 1.9,
    groups: [{ id: 'albedo', contribution: 0.2 }, { id: 'sealing', contribution: 'x' }],
    other: 0.4,
    modelGap: 0.3,
    sample: { inside: 1500, ring: 1400 },
  },
  scenarios: [
    {
      id: 'cool_roofs',
      treatedDT: [-4.1, -3.6, -3.2],
      wholeDT: [-0.9, -0.8, -0.7],
      areaShare: 0.25,
      settings: { albedo: 0.55, emissivity: null },
      assumptions: [{ id: 'albedo', text: 'Roofs at 0.55.' }, { id: 7 }],
    },
    { id: 'trees', treatedDT: null, wholeDT: [-0.2, -0.1, -0.05] },
    { id: 'broken', wholeDT: [-0.1, -0.3, 0] },
  ],
  replicates: 10,
  interval: [5, 95],
};

describe('parsePhysics', () => {
  it('reads a city whole', () => {
    const p = parsePhysics({ tashkent: city }).tashkent;
    expect(p?.skill.physics).toEqual(skill);
    expect(p?.skill.insidePhysics?.r2).toBe(0.2);
    expect(p?.skill.insideHybrid).toBeNull();
    expect(p?.fluxes?.ring.qf).toBe(5);
    expect(p?.budget?.sample).toEqual({ inside: 1500, ring: 1400 });
    expect(p?.scenarios[0]).toEqual({
      id: 'cool_roofs',
      treated: { low: -4.1, mid: -3.6, high: -3.2 },
      whole: { low: -0.9, mid: -0.8, high: -0.7 },
      areaShare: 0.25,
      settings: { albedo: 0.55, emissivity: null },
      assumptions: [{ id: 'albedo', text: 'Roofs at 0.55.' }],
    });
    expect(p?.interval).toEqual([5, 95]);
  });

  it('drops malformed pieces and keeps the rest', () => {
    const p = parsePhysics({ tashkent: city }).tashkent;
    expect(p?.budget?.groups).toEqual([{ id: 'albedo', contribution: 0.2 }]);
    // No treated range is fine; an unordered range drops the scenario.
    expect(p?.scenarios.map((s) => s.id)).toEqual(['cool_roofs', 'trees']);
    expect(p?.scenarios[1]?.treated).toBeNull();
    expect(p?.scenarios[1]?.settings).toEqual({});
  });

  it('drops a city without the skill of the physics, and parts that do not parse', () => {
    const p = parsePhysics({ a: { skill: { hybrid: skill } }, b: { skill: { physics: skill }, fluxes: { inside: fluxes }, budget: { observed: 1 } } });
    expect(p.a).toBeUndefined();
    expect(p.b?.fluxes).toBeNull();
    expect(p.b?.budget).toBeNull();
    expect(p.b?.scenarios).toEqual([]);
    expect(parsePhysics(null)).toEqual({});
    expect(parsePhysics([city])).toEqual({});
  });
});

const filePath = join(__dirname, '../../public/data/physics.json');

describe('physics.json from the pipeline', () => {
  it.runIf(existsSync(filePath))('parses every city whole, with a budget that adds up', () => {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const parsed = parsePhysics(raw);
    expect(Object.keys(parsed)).toEqual(Object.keys(raw));
    for (const city of Object.values(parsed)) {
      expect(city.fluxes).not.toBeNull();
      expect(city.scenarios).toHaveLength(6);
      const budget = city.budget;
      expect(budget?.groups).toHaveLength(8);
      const explained = (budget?.groups ?? []).reduce((sum, g) => sum + g.contribution, 0);
      expect(Math.abs(explained + (budget?.other ?? NaN) - (budget?.observed ?? NaN))).toBeLessThan(0.01);
    }
  });
});
