import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { solveCell } from './solve';
import { TILES, type CellForcing, type CellInputs, type CellState, type Params } from './types';

interface GoldenCase {
  inputs: CellInputs;
  forcing: CellForcing;
  params: Params;
  expected: CellState;
}

/** Written by `python -m pipeline.seb_golden` from the Python solver; pytest keeps it in sync. */
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8')) as {
  tiles: string[];
  cases: GoldenCase[];
};

const TEMPERATURE_TOLERANCE = 0.01; // K
const FLUX_TOLERANCE = 0.1; // W m⁻²
const FLUXES = ['rn', 'h', 'le', 'dqs', 'qf', 'residual'] as const;

function worst(cases: GoldenCase[], pick: (state: CellState, expected: CellState) => number[]): number {
  let max = 0;
  for (const c of cases) {
    const state = solveCell(c.inputs, c.forcing, c.params);
    for (const d of pick(state, c.expected)) max = Math.max(max, Math.abs(d));
  }
  return max;
}

describe('solveCell matches the Python solver (golden cases)', () => {
  it('uses the same tile order', () => {
    expect(golden.tiles).toEqual([...TILES]);
    expect(golden.cases.length).toBeGreaterThanOrEqual(40);
  });

  golden.cases.forEach((c, index) => {
    it(`case ${index}: wind ${c.forcing.wind} m/s, Ta ${c.forcing.tAir} K`, () => {
      const state = solveCell(c.inputs, c.forcing, c.params);
      const e = c.expected;
      for (let k = 0; k < TILES.length; k++) {
        const label = `${TILES[k]}`;
        expect(Math.abs(state.tSurface[k]! - e.tSurface[k]!), `${label} T`).toBeLessThan(TEMPERATURE_TOLERANCE);
        for (const name of FLUXES) {
          expect(Math.abs(state[name][k]! - e[name][k]!), `${label} ${name}`).toBeLessThan(FLUX_TOLERANCE);
        }
        expect(state.converged[k], `${label} converged`).toBe(e.converged[k]);
        expect(state.stabilityFallback[k], `${label} fallback`).toBe(e.stabilityFallback[k]);
      }
      expect(Math.abs(state.tCell - e.tCell)).toBeLessThan(TEMPERATURE_TOLERANCE);
    });
  });

  it('reproduces the cases far tighter than the tolerance', () => {
    // Same arithmetic in the same order: only libm rounding differs, so the gap should be tiny.
    expect(worst(golden.cases, (s, e) => s.tSurface.map((t, k) => t - e.tSurface[k]!))).toBeLessThan(1e-6);
    expect(worst(golden.cases, (s, e) => [s.tCell - e.tCell])).toBeLessThan(1e-6);
  });

  it('closes the balance with the fluxes it reports', () => {
    for (const c of golden.cases) {
      const s = solveCell(c.inputs, c.forcing, c.params);
      s.tSurface.forEach((_, k) => {
        const balance = s.rn[k]! + s.qf[k]! - s.h[k]! - s.le[k]! - s.dqs[k]!;
        expect(Math.abs(balance - s.residual[k]!)).toBeLessThan(1e-9);
      });
    }
  });
});
