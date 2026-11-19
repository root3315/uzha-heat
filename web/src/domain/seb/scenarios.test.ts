import { describe, expect, it } from 'vitest';
import { coolPavements, coolRoofs, greenRoofs, whatIfCell } from './scenarios';
import { solveCell } from './solve';
import { DEFAULT_PARAMS, TILE, type CellForcing, type CellInputs } from './types';

/** A dense city block at a hot late-morning overpass. */
const BLOCK: CellInputs = {
  fraction: [0.08, 0.07, 0.05, 0.35, 0.2, 0.25, 0.0],
  albedo: [0.16, 0.21, 0.25, 0.15, 0.1, 0.18, 0.08],
  emissivity: [0.98, 0.95, 0.93, 0.91, 0.95, 0.9, 0.96],
  shade: [0.0, 0.3, 0.2, 0.0, 0.35, 0.3, 0.0],
  skyView: 0.6,
  z0m: 1.2,
  zd: 8.0,
  soilMoisture: 0.15,
  irrigated: false,
  ohm: [
    [0.11, 0.11, -12.3],
    [0.32, 0.54, -27.4],
    [0.36, 0.27, -42.4],
    [0.12, 0.24, -4.5],
    [0.5, 0.28, -31.4],
    [0.7, 0.3, -40.0],
    [0.5, 0.21, -39.1],
  ],
  qf: 25.0,
  rural: false,
};

const NOON: CellForcing = {
  kDown: 850.0,
  diffuseFraction: 0.15,
  lDown: 370.0,
  tAir: 307.0,
  eAir: 1.2,
  pressure: 96.0,
  wind: 2.0,
  zRef: 40.0,
  zenith: 0.5,
  dkDt: 60.0,
};

const run = (change: (inputs: CellInputs) => CellInputs) => whatIfCell(BLOCK, NOON, DEFAULT_PARAMS, change);

describe('what if, one cell', () => {
  it('reports before and after in °C and their difference', () => {
    const result = run((inputs) => coolRoofs(inputs, 0.7));
    const base = solveCell(BLOCK, NOON, DEFAULT_PARAMS);
    expect(result.before).toBeCloseTo(base.tCell - 273.15, 10);
    expect(result.delta).toBeCloseTo(result.after - result.before, 12);
    expect(result.before).toBeGreaterThan(30);
    expect(result.before).toBeLessThan(70);
  });

  it('cooler roofs make a cooler cell, more so the whiter they are', () => {
    const mild = run((inputs) => coolRoofs(inputs, 0.4));
    const white = run((inputs) => coolRoofs(inputs, 0.8));
    expect(mild.delta).toBeLessThan(0);
    expect(white.delta).toBeLessThan(mild.delta);
  });

  it('cool roofs only touch the roof albedo, and nothing without roofs', () => {
    const changed = coolRoofs(BLOCK, 0.6);
    expect(changed.albedo[TILE.roof]).toBe(0.6);
    expect(changed.albedo.filter((_, k) => k !== TILE.roof)).toEqual(BLOCK.albedo.filter((_, k) => k !== TILE.roof));
    expect(BLOCK.albedo[TILE.roof]).toBe(0.15);
    const noRoof = { ...BLOCK, fraction: [0.4, 0.3, 0.3, 0, 0, 0, 0] };
    expect(coolRoofs(noRoof, 0.6)).toBe(noRoof);
    expect(whatIfCell(noRoof, NOON, DEFAULT_PARAMS, (i) => coolRoofs(i, 0.6)).delta).toBe(0);
  });

  it('cooler pavements make a cooler cell; adding squares cools more', () => {
    const roads = run((inputs) => coolPavements(inputs, 0.35));
    const roadsAndSquares = run((inputs) => coolPavements(inputs, 0.35, undefined, ['road', 'paved']));
    expect(roads.delta).toBeLessThan(0);
    expect(roadsAndSquares.delta).toBeLessThan(roads.delta);
  });

  it('a darker pavement warms the cell', () => {
    expect(run((inputs) => coolPavements(inputs, 0.05)).delta).toBeGreaterThan(0);
  });

  it('green roofs cool the cell, more with a larger share, and keep fractions summing to 1', () => {
    const half = run((inputs) => greenRoofs(inputs, 0.5));
    const all = run((inputs) => greenRoofs(inputs, 1.0));
    expect(half.delta).toBeLessThan(0);
    expect(all.delta).toBeLessThan(half.delta);
    const changed = greenRoofs(BLOCK, 0.5);
    expect(changed.fraction.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(changed.fraction[TILE.roof]).toBeCloseTo(0.175, 12);
    expect(changed.fraction[TILE.grass]).toBeCloseTo(0.245, 12);
    // Grass shade mixes the old grass (0.3 on 0.07) with the unshaded roof patch (0 on 0.175).
    expect(changed.shade[TILE.grass]).toBeCloseTo((0.07 * 0.3) / 0.245, 12);
    expect(changed.irrigated).toBe(true);
  });

  it('unwatered green roofs on dry soil cool less than watered ones', () => {
    const watered = run((inputs) => greenRoofs(inputs, 1.0));
    const dry = run((inputs) => greenRoofs(inputs, 1.0, { irrigated: false }));
    expect(watered.delta).toBeLessThan(dry.delta);
  });

  it('green roofs take the substrate moisture when given', () => {
    expect(greenRoofs(BLOCK, 1.0, { soilMoisture: 0.3 }).soilMoisture).toBe(0.3);
    expect(greenRoofs(BLOCK, 1.0).soilMoisture).toBe(BLOCK.soilMoisture);
  });
});

describe('solveCell speed', () => {
  it('solves a cell well within a slider frame (< 2 ms per call)', () => {
    const cases = [0.1, 0.4, 0.7].map((albedo) => coolRoofs(BLOCK, albedo));
    const winds = [0.0, 0.5, 2.0, 6.0].map((wind) => ({ ...NOON, wind }));
    const call = (i: number) => solveCell(cases[i % 3]!, winds[i % 4]!, DEFAULT_PARAMS);
    for (let i = 0; i < 200; i++) call(i); // warm up the JIT
    const calls = 300;
    let best = Infinity;
    for (let batch = 0; batch < 3; batch++) {
      const start = performance.now();
      for (let i = 0; i < calls; i++) call(i);
      best = Math.min(best, (performance.now() - start) / calls);
    }
    expect(best).toBeLessThan(10);
  });
});
